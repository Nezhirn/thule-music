"""Admins manage the library: albums renamed or deleted, tracks edited, moved to another
album, uploaded into one or deleted, artists renamed.

Every change goes into the files first (tags, folders), and the changed files are imported
again at once: the library shows what a scan of the folder would, and a later scan changes
nothing. Albums and artists are renamed in place, so their ids, and with them likes and
links, stay; given the name of another one, they are merged into it. A write that fails
halfway (a read-only file, a full disk) still imports what was written before it."""

import asyncio
import enum
import uuid
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Annotated, Self

from fastapi import APIRouter, Query, UploadFile, status
from pydantic import Field, StringConstraints, model_validator
from sqlalchemy import ColumnElement, Uuid, literal, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.config import AUDIO_EXTENSIONS, Settings
from app.deps import AdminUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode
from app.library import files
from app.library.importer import (
    Imported,
    choose_covers,
    delete_orphans,
    import_file,
    queue_follow_ups,
    resolve_in_library,
    upsert_artist,
)
from app.library.models import Album, Artist, Track, TrackArtist, name_key
from app.library.queries import (
    ALBUM_LOAD,
    TRACK_ORDER,
    albums_out,
    artists_out,
    track_select,
    tracks_out,
)
from app.library.tags import UNKNOWN_ARTIST, UnreadableAudio, read_tags, rename_featured
from app.library.tagwrite import TagsNotWritable, Values, can_write, write_tags
from app.me.models import AlbumLike, ArtistLike
from app.schemas import AlbumOut, ApiModel, ArtistOut, TrackOut

manage_router = APIRouter(tags=["admin"])

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=512)]
Genre = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)]


class AlbumPatch(ApiModel):
    title: Name | None = None
    # The album artist.
    artist: Name | None = None
    # null clears it.
    year: int | None = Field(default=None, ge=1000, le=9999)
    genre: Genre | None = None


class TrackPatch(ApiModel):
    title: Name | None = None
    # Everyone credited, the main artist first.
    artists: list[Name] | None = Field(default=None, min_length=1, max_length=20)
    # null clears them.
    track_no: int | None = Field(default=None, ge=1, le=999)
    disc_no: int | None = Field(default=None, ge=1, le=99)


class NewAlbum(ApiModel):
    title: Name
    artist: Name


class TrackMove(ApiModel):
    track_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    # Into an album of the library, or into a new one: its files go to "<artist>/<title>/".
    album_id: uuid.UUID | None = None
    new_album: NewAlbum | None = None

    @model_validator(mode="after")
    def one_album(self) -> Self:
        if (self.album_id is None) == (self.new_album is None):
            raise ValueError("Give either album_id or new_album")
        return self


class ArtistPatch(ApiModel):
    name: Name


class AlbumDeletion(enum.StrEnum):
    # The tracks' files are deleted from the disk.
    delete = "delete"
    # Each track becomes a single of its artist, titled after it; the files stay.
    singles = "singles"


class AlbumUpload(ApiModel):
    track: TrackOut
    # The same file (byte for byte) is already a track of the library: nothing was saved,
    # and `track` is that one.
    duplicate: bool = False


def _unique(names: Iterable[str]) -> list[str]:
    """Names in order, each once: "A" and "a " are one artist."""
    seen: set[str] = set()
    unique = []
    for name in names:
        if name_key(name) not in seen:
            seen.add(name_key(name))
            unique.append(name)
    return unique


# --- loading -------------------------------------------------------------------------------


async def _album(session: AsyncSession, album_id: uuid.UUID) -> Album:
    album = await session.scalar(select(Album).where(Album.id == album_id).options(*ALBUM_LOAD))
    if album is None:
        raise ApiError(ErrorCode.album_not_found)
    return album


async def _tracks(session: AsyncSession, *where: ColumnElement[bool]) -> list[Track]:
    return list(await session.scalars(track_select().where(*where).order_by(*TRACK_ORDER)))


async def _track(session: AsyncSession, track_id: uuid.UUID) -> Track:
    tracks = await _tracks(session, Track.id == track_id)
    if not tracks:
        raise ApiError(ErrorCode.track_not_found)
    return tracks[0]


async def _album_out(session: AsyncSession, admin: AdminUser, album_id: uuid.UUID) -> AlbumOut:
    album = await session.scalar(
        select(Album)
        .where(Album.id == album_id)
        .options(*ALBUM_LOAD)
        .execution_options(populate_existing=True)
    )
    assert album is not None
    (out,) = await albums_out(session, admin.id, [album])
    return out


async def _track_out(session: AsyncSession, admin: AdminUser, track_id: uuid.UUID) -> TrackOut:
    track = await session.scalar(
        track_select().where(Track.id == track_id).execution_options(populate_existing=True)
    )
    assert track is not None
    (out,) = await tracks_out(session, admin.id, [track])
    return out


# --- files ---------------------------------------------------------------------------------


def _path(settings: Settings, track: Track) -> Path:
    return resolve_in_library(settings.library_path, track.path)


def _rel(settings: Settings, path: Path) -> str:
    return path.relative_to(settings.library_path.resolve()).as_posix()


def _writable(tracks: Iterable[Track]) -> None:
    """Refuses, before anything changes, tracks whose files can't hold the tags."""
    for track in tracks:
        if not can_write(Path(track.path)):
            raise ApiError(
                ErrorCode.tags_not_writable,
                f"Can't write tags to {Path(track.path).name}: WAV, WMA and AAC aren't supported",
            )


async def _write_tags(path: Path, values: Values) -> None:
    try:
        await files.write(write_tags, path, values)
    except TagsNotWritable as exc:
        raise ApiError(ErrorCode.tags_not_writable, f"Can't write tags to {exc}") from exc


async def _reimport(
    session: AsyncSession,
    settings: Settings,
    rels: Iterable[str],
    *,
    transcode: bool = False,
    albums: Iterable[uuid.UUID] = (),
) -> list[Imported]:
    """Imports the changed files again, then what follows once for all of them: albums and
    artists left empty go, covers of the albums concerned (`albums` and theirs) are chosen
    again, lyrics are looked up (and transcodes made, for new audio)."""
    imported = []
    for rel in dict.fromkeys(rels):
        try:
            result = await import_file(session, settings.library_path, rel)
        except UnreadableAudio as exc:
            raise ApiError(ErrorCode.not_an_audio_file, str(exc)) from exc
        if result is not None:
            imported.append(result)
    await delete_orphans(session)
    album_ids = set(albums) | {i.album.id for i in imported}
    album_ids |= {i.previous_album_id for i in imported if i.previous_album_id is not None}
    await choose_covers(session, settings.library_path, settings.covers_path, album_ids)
    for result in imported:
        await queue_follow_ups(session, result, transcode=transcode)
    return imported


async def _retag(
    session: AsyncSession,
    settings: Settings,
    tracks: list[Track],
    values: Callable[[Track], Values],
) -> None:
    """Writes each track's tags. When a write fails, the files written before it are
    imported and committed, so the library still matches the folder, and the error is
    raised."""
    _writable(tracks)
    done: list[str] = []
    try:
        for track in tracks:
            await _write_tags(_path(settings, track), values(track))
            done.append(track.path)
    except BaseException:
        await _reimport(session, settings, done)
        await session.commit()
        raise


def _album_folder(settings: Settings, tracks: list[Track], disc_no: int | None) -> Path:
    """Where a file joining an album goes: beside its tracks of the same disc, else beside
    its first track."""
    same_disc = [t for t in tracks if t.disc_no == disc_no and disc_no is not None]
    return _path(settings, (same_disc or tracks)[0]).parent


def _album_values(album: Album) -> dict[str, str | list[str] | None]:
    """The tags making a file one of the album's tracks."""
    values: dict[str, str | list[str] | None] = {
        "album": album.title,
        "albumartist": album.artist.name,
    }
    if album.year is not None:
        values["date"] = str(album.year)
    if album.genre is not None:
        values["genre"] = album.genre
    return values


async def _move_likes(
    session: AsyncSession,
    column: InstrumentedAttribute[uuid.UUID],
    old: uuid.UUID,
    new: uuid.UUID,
) -> None:
    """Likes of an album or artist merged into another become likes of that one.
    `column`: AlbumLike.album_id or ArtistLike.artist_id."""
    model = column.class_
    await session.execute(
        insert(model)
        .from_select(
            ["user_id", column.key, "created_at"],
            select(model.user_id, literal(new, Uuid), model.created_at).where(column == old),
        )
        .on_conflict_do_nothing()
    )


async def _delete_files(session: AsyncSession, settings: Settings, tracks: list[Track]) -> None:
    """Deletes the tracks' files (with their lyrics files) and the tracks, and the folders
    that leaves without music. When a delete fails, the tracks deleted before it go."""
    deleted: list[Track] = []
    folders: set[Path] = set()
    try:
        for track in tracks:
            path = _path(settings, track)
            await files.write(files.delete_track_file, path)
            deleted.append(track)
            folders.add(path.parent)
    finally:
        for track in deleted:
            await session.delete(track)
        await session.flush()
        await delete_orphans(session)
        album_ids = {t.album_id for t in deleted}
        await choose_covers(session, settings.library_path, settings.covers_path, album_ids)
        for folder in folders:
            await asyncio.to_thread(files.prune, folder, settings.library_path)
        await session.commit()


# --- albums --------------------------------------------------------------------------------


@manage_router.patch("/albums/{album_id}", response_model=AlbumOut)
async def update_album(
    album_id: uuid.UUID,
    body: AlbumPatch,
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
) -> AlbumOut:
    """Renames the album, changes its artist, year or genre: in its tracks' tags. Given the
    title and artist of another album, it is merged into that one (the result has its id)."""
    album = await _album(session, album_id)
    tracks = await _tracks(session, Track.album_id == album.id)
    fields = body.model_fields_set
    values: dict[str, str | list[str] | None] = {}
    if body.title is not None and body.title != album.title:
        values["album"] = body.title
    if body.artist is not None and body.artist != album.artist.name:
        values["albumartist"] = body.artist
    if "year" in fields and body.year != album.year:
        values["date"] = str(body.year) if body.year else None
    if "genre" in fields and body.genre != album.genre:
        values["genre"] = body.genre
    if not values:
        return await _album_out(session, admin, album.id)

    await _retag(session, settings, tracks, lambda _: values)
    title = body.title or album.title
    artist_id = await upsert_artist(session, body.artist) if body.artist else album.artist_id
    twin = await session.scalar(
        select(Album).where(
            Album.artist_id == artist_id, Album.title_key == name_key(title), Album.id != album.id
        )
    )
    if twin is None:
        album.title, album.title_key, album.artist_id = title, name_key(title), artist_id
        if "date" in values:
            album.year = body.year
        if "genre" in values:
            album.genre = body.genre
        result = album.id
    else:
        await _move_likes(session, AlbumLike.album_id, album.id, twin.id)
        result = twin.id
    await session.flush()
    await _reimport(session, settings, [t.path for t in tracks])
    await session.commit()
    return await _album_out(session, admin, result)


@manage_router.delete("/albums/{album_id}", response_model=list[AlbumOut])
async def delete_album(
    album_id: uuid.UUID,
    tracks: Annotated[AlbumDeletion, Query()],
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
) -> list[AlbumOut]:
    """`tracks=delete` deletes the album's files from the disk (and the folders left without
    music). `tracks=singles` keeps them: each becomes a single of its artist, titled after
    it. Returns the singles."""
    album = await _album(session, album_id)
    album_tracks = await _tracks(session, Track.album_id == album.id)
    if tracks == AlbumDeletion.delete:
        await _delete_files(session, settings, album_tracks)
        return []

    def single(track: Track) -> Values:
        return {
            "album": track.title,
            "albumartist": track.artist.name,
            "tracknumber": None,
            "discnumber": None,
        }

    await _retag(session, settings, album_tracks, single)
    # The album's cover, for singles whose files have none of their own.
    cover_id = album.cover_id
    imported = await _reimport(session, settings, [t.path for t in album_tracks])
    singles = {i.album.id: i.album for i in imported}
    for one in singles.values():
        if one.cover_id is None and cover_id is not None:
            one.cover_id, one.cover_custom = cover_id, True
    await session.commit()
    return [await _album_out(session, admin, one) for one in singles]


@manage_router.post(
    "/albums/{album_id}/tracks", response_model=AlbumUpload, status_code=status.HTTP_201_CREATED
)
async def upload_to_album(
    album_id: uuid.UUID,
    file: UploadFile,
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
) -> AlbumUpload:
    """Adds an audio file to the album: saved beside its tracks, tagged as one of them (the
    album, its artist, year and genre; the next number if it has none) and imported at
    once. MP3, FLAC, Ogg, Opus or M4A: the formats whose tags can be written."""
    album = await _album(session, album_id)
    tracks = await _tracks(session, Track.album_id == album.id)
    name = files.safe_name(file.filename or "upload")
    if Path(name).suffix.casefold() not in AUDIO_EXTENSIONS:
        raise ApiError(ErrorCode.not_an_audio_file, f"Can't upload {file.filename}")
    if not can_write(Path(name)):
        raise ApiError(ErrorCode.tags_not_writable, f"Can't write tags to {file.filename}")

    folder = _album_folder(settings, tracks, None)
    await files.write(folder.mkdir, parents=True, exist_ok=True)
    dest, digest = await files.write(files.save_upload, file.file, folder, name)
    try:
        same = await _same_track(session, settings, dest, digest)
        if same is not None:
            await asyncio.to_thread(dest.unlink)
            return AlbumUpload(track=await _track_out(session, admin, same), duplicate=True)
        try:
            tags = await asyncio.to_thread(read_tags, dest, lyrics=False)
        except UnreadableAudio as exc:
            raise ApiError(ErrorCode.not_an_audio_file, str(exc)) from exc
        values = _album_values(album)
        if tags.artists == [UNKNOWN_ARTIST]:
            values["artist"] = album.artist.name
        if tags.track_no is None:
            values["tracknumber"] = str(max((t.track_no or 0 for t in tracks), default=0) + 1)
        await _write_tags(dest, values)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    (imported,) = await _reimport(session, settings, [_rel(settings, dest)], transcode=True)
    await session.commit()
    return AlbumUpload(track=await _track_out(session, admin, imported.track.id))


async def _same_track(
    session: AsyncSession, settings: Settings, saved: Path, digest: str
) -> uuid.UUID | None:
    """A track whose file has the same content as the one just saved."""
    size = (await asyncio.to_thread(saved.stat)).st_size
    for track_id, rel in await session.execute(
        select(Track.id, Track.path).where(Track.size == size).limit(20)
    ):
        full = resolve_in_library(settings.library_path, rel)
        if full != saved and await asyncio.to_thread(files.sha256, full) == digest:
            return track_id
    return None


# --- tracks --------------------------------------------------------------------------------


@manage_router.patch("/tracks/{track_id}", response_model=TrackOut)
async def update_track(
    track_id: uuid.UUID,
    body: TrackPatch,
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
) -> TrackOut:
    """Changes the track's title, artists, number or disc: in its file's tags."""
    track = await _track(session, track_id)
    fields = body.model_fields_set
    values: dict[str, str | list[str] | None] = {}
    if body.title is not None and body.title != track.title:
        values["title"] = body.title
    if body.artists is not None:
        names = _unique(body.artists)
        if names != [c.artist.name for c in track.credits]:
            values["artist"] = names
    if "track_no" in fields and body.track_no != track.track_no:
        values["tracknumber"] = str(body.track_no) if body.track_no else None
    if "disc_no" in fields and body.disc_no != track.disc_no:
        values["discnumber"] = str(body.disc_no) if body.disc_no else None
    if values:
        await _retag(session, settings, [track], lambda _: values)
        await _reimport(session, settings, [track.path])
        await session.commit()
    return await _track_out(session, admin, track.id)


@manage_router.delete("/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_track(
    track_id: uuid.UUID, session: SessionDep, settings: SettingsDep, _: AdminUser
) -> None:
    """Deletes the track's file (and its lyrics files) from the disk."""
    await _delete_files(session, settings, [await _track(session, track_id)])


@manage_router.post("/tracks/move", response_model=AlbumOut)
async def move_tracks(
    body: TrackMove, session: SessionDep, settings: SettingsDep, admin: AdminUser
) -> AlbumOut:
    """Moves tracks into another album: their files go beside its tracks (with their
    lyrics files) and are tagged as its own. Returns that album."""
    tracks = await _tracks(session, Track.id.in_(body.track_ids))
    if len(tracks) != len(set(body.track_ids)):
        raise ApiError(ErrorCode.unknown_tracks)

    target: Album | None = None
    if body.album_id is not None:
        target = await _album(session, body.album_id)
    else:
        assert body.new_album is not None
        artist = await session.scalar(
            select(Artist).where(Artist.name_key == name_key(body.new_album.artist))
        )
        if artist is not None:
            target = await session.scalar(
                select(Album)
                .where(
                    Album.artist_id == artist.id,
                    Album.title_key == name_key(body.new_album.title),
                )
                .options(*ALBUM_LOAD)
            )

    if target is not None:
        target_tracks = await _tracks(session, Track.album_id == target.id)
        values = _album_values(target)

        def folder(track: Track) -> Path:
            return _album_folder(settings, target_tracks, track.disc_no)
    else:
        assert body.new_album is not None
        new = body.new_album
        values = {"album": new.title, "albumartist": new.artist}
        new_folder = (
            settings.library_path.resolve()
            / (files.safe_part(new.artist) or "Unknown Artist")
            / (files.safe_part(new.title) or "Unknown Album")
        )

        def folder(track: Track) -> Path:
            return new_folder

    moving = [t for t in tracks if target is None or t.album_id != target.id]
    _writable(moving)
    done: list[str] = []
    left: set[Path] = set()
    albums = {t.album_id for t in moving}
    try:
        for track in moving:
            old = _path(settings, track)
            moved = await files.write(files.move_track_file, old, folder(track))
            track.path = _rel(settings, moved)
            await session.flush()
            done.append(track.path)
            left.add(old.parent)
            await _write_tags(moved, values)
    finally:
        imported = await _reimport(session, settings, done, albums=albums)
        for path in left:
            await asyncio.to_thread(files.prune, path, settings.library_path)
        await session.commit()
    result = target.id if target is not None else imported[0].album.id
    return await _album_out(session, admin, result)


# --- artists -------------------------------------------------------------------------------


@manage_router.patch("/artists/{artist_id}", response_model=ArtistOut)
async def rename_artist(
    artist_id: uuid.UUID,
    body: ArtistPatch,
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
) -> ArtistOut:
    """Renames the artist in the tags of every track crediting them and every track of
    their albums ("feat." in titles too). Given another artist's name, they are merged into
    that one (the result has its id), their albums with the same titles too."""
    artist = await session.get(Artist, artist_id)
    if artist is None:
        raise ApiError(ErrorCode.artist_not_found)
    if body.name == artist.name:
        return (await artists_out(session, admin.id, [artist]))[0]

    credited = select(TrackArtist.track_id).where(TrackArtist.artist_id == artist.id)
    theirs = select(Album.id).where(Album.artist_id == artist.id)
    tracks = await _tracks(session, Track.id.in_(credited) | Track.album_id.in_(theirs))
    old, new = artist.name, body.name

    def values(track: Track) -> Values:
        changed: dict[str, str | list[str] | None] = {}
        if any(c.artist_id == artist.id for c in track.credits):
            names = [new if c.artist_id == artist.id else c.artist.name for c in track.credits]
            changed["artist"] = _unique(names)
            if (title := rename_featured(track.title, old, new)) != track.title:
                changed["title"] = title
        if track.album.artist_id == artist.id:
            changed["albumartist"] = new
        return changed

    await _retag(session, settings, tracks, values)
    other = await session.scalar(
        select(Artist).where(Artist.name_key == name_key(new), Artist.id != artist.id)
    )
    if other is None:
        artist.name, artist.name_key = new, name_key(new)
        result = artist
    else:
        await _merge_artist(session, artist, other)
        result = other
    await session.flush()
    await _reimport(session, settings, [t.path for t in tracks])
    await session.commit()
    await session.refresh(result)
    return (await artists_out(session, admin.id, [result]))[0]


async def _merge_artist(session: AsyncSession, artist: Artist, other: Artist) -> None:
    """Gives `other` what is `artist`'s, before the files are imported again: their albums
    (merged into `other`'s of the same title), credits and likes. So albums keep their ids
    where they can."""
    for album in await session.scalars(select(Album).where(Album.artist_id == artist.id)):
        twin = await session.scalar(
            select(Album).where(Album.artist_id == other.id, Album.title_key == album.title_key)
        )
        if twin is None:
            album.artist_id = other.id
        else:
            await session.execute(
                update(Track).where(Track.album_id == album.id).values(album_id=twin.id)
            )
            await _move_likes(session, AlbumLike.album_id, album.id, twin.id)
    await session.execute(
        update(Track).where(Track.artist_id == artist.id).values(artist_id=other.id)
    )
    await session.execute(
        update(TrackArtist).where(TrackArtist.artist_id == artist.id).values(artist_id=other.id)
    )
    await _move_likes(session, ArtistLike.artist_id, artist.id, other.id)
