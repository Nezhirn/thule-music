"""Admins manage the library: albums renamed, given to another artist or deleted, tracks
edited, moved to another album, uploaded into one or deleted, artists renamed or deleted,
genres renamed or taken off.

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

from fastapi import APIRouter, Form, Query, UploadFile, status
from pydantic import Field, StringConstraints, model_validator
from sqlalchemy import (
    ARRAY,
    BigInteger,
    ColumnElement,
    Double,
    Uuid,
    func,
    literal,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.config import AUDIO_EXTENSIONS, Settings
from app.deps import AdminUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode
from app.jobs.queue import enqueue_many
from app.library import files
from app.library.importer import (
    Imported,
    LibraryUnavailable,
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
from app.library.tags import (
    UNKNOWN_ARTIST,
    UnreadableAudio,
    read_tags,
    remove_featured,
    rename_featured,
)
from app.library.tagwrite import TagsNotWritable, Values, can_write, write_tags
from app.lyrics.models import Lyrics
from app.me.models import AlbumLike, ArtistLike
from app.schemas import AlbumOut, ApiModel, ArtistOut, GenreOut, TrackOut

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


class AlbumsMove(ApiModel):
    album_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    # The artist they go to: one of the library, or a new one.
    artist: Name


class AlbumsGenre(ApiModel):
    album_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    genre: Genre


class GenrePatch(ApiModel):
    name: Genre


class AlbumDeletion(enum.StrEnum):
    # The tracks' files are deleted from the disk.
    delete = "delete"
    # Each track becomes a single of its artist, titled after it; the files stay.
    singles = "singles"


class GenreDeletion(enum.StrEnum):
    # The albums stay, without a genre.
    keep = "keep"
    # The files of the albums' tracks are deleted from the disk.
    delete = "delete"


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


async def _albums(session: AsyncSession, album_ids: list[uuid.UUID]) -> list[Album]:
    albums = list(
        await session.scalars(select(Album).where(Album.id.in_(album_ids)).options(*ALBUM_LOAD))
    )
    if len(albums) != len(set(album_ids)):
        raise ApiError(ErrorCode.unknown_albums)
    return albums


async def _artist(session: AsyncSession, artist_id: uuid.UUID) -> Artist:
    artist = await session.get(Artist, artist_id)
    if artist is None:
        raise ApiError(ErrorCode.artist_not_found)
    return artist


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


# Files imported again per transaction (see _reimport).
REIMPORT_BATCH = 200


async def _reimport(
    session: AsyncSession,
    settings: Settings,
    rels: Iterable[str],
    *,
    transcode: bool = False,
    lyrics: bool = True,
    albums: Iterable[uuid.UUID] = (),
) -> list[Imported]:
    """Imports the changed files again, then what follows once for all of them: albums and
    artists left empty go, covers of the albums concerned (`albums` and theirs) are chosen
    again, lyrics are looked up (unless the change doesn't touch what they are looked up
    by: title, artist, album), and transcodes made, for new audio."""
    imported = []
    for n, rel in enumerate(dict.fromkeys(rels), start=1):
        try:
            result = await import_file(session, settings.library_path, rel)
        except UnreadableAudio as exc:
            raise ApiError(ErrorCode.not_an_audio_file, str(exc)) from exc
        except LibraryUnavailable as exc:
            raise ApiError(ErrorCode.library_unavailable) from exc
        if result is not None:
            imported.append(result)
        if n % REIMPORT_BATCH == 0:
            # The files are written already: what is imported of them is kept as it goes,
            # in transactions of a bounded size (a scan would import the rest).
            await session.commit()
    await delete_orphans(session)
    album_ids = set(albums) | {i.album.id for i in imported}
    album_ids |= {i.previous_album_id for i in imported if i.previous_album_id is not None}
    await choose_covers(session, settings.library_path, settings.covers_path, album_ids)
    for result in imported:
        await queue_follow_ups(session, result, transcode=transcode, lyrics=lyrics)
    return imported


async def _prune(settings: Settings, folders: Iterable[Path]) -> None:
    """Removes the folders that were left without music (after the commit: tidying that
    fails changes nothing that was done). The uploads folder stays."""
    for folder in folders:
        await asyncio.to_thread(
            files.prune, folder, settings.library_path, keep=[settings.uploads_path]
        )


async def _retag(
    session: AsyncSession,
    settings: Settings,
    tracks: list[Track],
    values: Callable[[Track], Values],
) -> set[uuid.UUID]:
    """Writes each track's tags. When a write fails, the files written before it are
    imported and committed, so the library still matches the folder, and the error is
    raised. Returns the tracks whose file was as last imported before it was written (the
    others changed on the disk since)."""
    _writable(tracks)
    # What was read stays usable; no transaction is held open while files are written, which
    # may take minutes (the database closes one left idle).
    await session.commit()
    done: list[str] = []
    in_step: set[uuid.UUID] = set()
    try:
        for track in tracks:
            path = _path(settings, track)
            if await asyncio.to_thread(_stat, path) == (track.size, track.mtime):
                in_step.add(track.id)
            await _write_tags(path, values(track))
            done.append(track.path)
    except BaseException:
        await _reimport(session, settings, done)
        await session.commit()
        raise
    return in_step


async def _look_up_lyrics(session: AsyncSession, tracks: list[Track]) -> None:
    """Lyrics looked up again for the tracks that have none found yet: their new names may
    find some. (Lyrics found once are kept.)"""
    found = select(Lyrics.track_id).where(Lyrics.source != "none")
    missing = await session.scalars(
        select(Track.id).where(Track.id.in_([t.id for t in tracks]), Track.id.not_in(found))
    )
    await enqueue_many(
        session, "fetch_lyrics", [({"track_id": str(i)}, f"lyrics:{i}") for i in missing]
    )


def _stat(path: Path) -> tuple[int, float] | None:
    try:
        st = path.stat()
    except OSError:
        return None
    return st.st_size, st.st_mtime


async def _restat(session: AsyncSession, settings: Settings, tracks: list[Track]) -> None:
    """Records the tracks' files' new size and time, for tags the database already holds
    (so that a scan finds nothing to do): one statement, not an import of each file."""
    stats = await asyncio.to_thread(lambda: [_stat(_path(settings, t)) for t in tracks])
    rows = [(t.id, st) for t, st in zip(tracks, stats, strict=True) if st is not None]
    if not rows:
        return
    changed = (
        func.unnest(
            literal([i for i, _ in rows], ARRAY(Uuid)),
            literal([st[0] for _, st in rows], ARRAY(BigInteger)),
            literal([st[1] for _, st in rows], ARRAY(Double)),
        )
        .table_valued("id", "size", "mtime")
        .render_derived()
    )
    await session.execute(
        update(Track)
        .where(Track.id == changed.c.id)
        .values(size=changed.c.size, mtime=changed.c.mtime)
    )


def _album_folder(settings: Settings, tracks: list[Track], disc_no: int | None) -> Path:
    """Where a file joining an album goes: beside its tracks of the same disc, else beside
    its first track."""
    same_disc = [t for t in tracks if t.disc_no == disc_no and disc_no is not None]
    return _path(settings, (same_disc or tracks)[0]).parent


def _new_album_folder(settings: Settings, artist: str, title: str) -> Path:
    """Where the files of a new album go: "<artist>/<title>/"."""
    return (
        settings.library_path.resolve()
        / (files.safe_part(artist) or "Unknown Artist")
        / (files.safe_part(title) or "Unknown Album")
    )


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
        await session.commit()
        await _prune(settings, folders)


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
    looked_up_by = {"album", "albumartist"} & values.keys()
    await _reimport(session, settings, [t.path for t in tracks], lyrics=bool(looked_up_by))
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
    folder = _album_folder(settings, tracks, None)
    return await _upload(
        session, settings, admin, file, folder, _album_values(album), album.artist.name, tracks
    )


@manage_router.post(
    "/artists/{artist_id}/tracks",
    response_model=AlbumUpload,
    status_code=status.HTTP_201_CREATED,
)
async def upload_to_artist(
    artist_id: uuid.UUID,
    file: UploadFile,
    album: Annotated[Name, Form()],
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
    year: Annotated[int | None, Form(ge=1000, le=9999)] = None,
    genre: Annotated[Genre | None, Form()] = None,
) -> AlbumUpload:
    """Adds an audio file to the artist's album titled `album`, as upload_to_album does. With
    no such album yet, it is a new one: the file goes to "<artist>/<album>/", tagged with the
    title, the artist, and `year` and `genre` if given."""
    artist = await _artist(session, artist_id)
    existing = await session.scalar(
        select(Album)
        .where(Album.artist_id == artist.id, Album.title_key == name_key(album))
        .options(*ALBUM_LOAD)
    )
    if existing is not None:
        tracks = await _tracks(session, Track.album_id == existing.id)
        folder = _album_folder(settings, tracks, None)
        values = _album_values(existing)
    else:
        tracks = []
        folder = _new_album_folder(settings, artist.name, album)
        values = {"album": album, "albumartist": artist.name}
        if year is not None:
            values["date"] = str(year)
        if genre is not None:
            values["genre"] = genre
    return await _upload(session, settings, admin, file, folder, values, artist.name, tracks)


async def _upload(
    session: AsyncSession,
    settings: Settings,
    admin: AdminUser,
    file: UploadFile,
    folder: Path,
    values: dict[str, str | list[str] | None],
    artist: str,
    tracks: list[Track],
) -> AlbumUpload:
    """Saves the file into `folder` and tags it with `values`; also with `artist` if it names
    none, and the number after `tracks`' if it has none. A file the library already has is
    not kept."""
    name = files.safe_name(file.filename or "upload")
    if Path(name).suffix.casefold() not in AUDIO_EXTENSIONS:
        raise ApiError(ErrorCode.not_an_audio_file, f"Can't upload {file.filename}")
    if not can_write(Path(name)):
        raise ApiError(ErrorCode.tags_not_writable, f"Can't write tags to {file.filename}")

    # No transaction left open while the file is copied (the database closes one idle for
    # long): what was read stays usable.
    await session.commit()
    # A folder made for it goes again if the file isn't kept.
    fresh = not await asyncio.to_thread(folder.exists)
    await files.write(folder.mkdir, parents=True, exist_ok=True)
    dest, digest = await files.write(files.save_upload, file.file, folder, name)

    async def give_up() -> None:
        dest.unlink(missing_ok=True)
        if fresh:
            await _prune(settings, [folder])

    try:
        same = await _same_track(session, settings, dest, digest)
        if same is not None:
            await give_up()
            return AlbumUpload(track=await _track_out(session, admin, same), duplicate=True)
        try:
            tags = await asyncio.to_thread(read_tags, dest, lyrics=False)
        except UnreadableAudio as exc:
            raise ApiError(ErrorCode.not_an_audio_file, str(exc)) from exc
        values = dict(values)
        if tags.artists == [UNKNOWN_ARTIST]:
            values["artist"] = artist
        if tags.track_no is None:
            values["tracknumber"] = str(max((t.track_no or 0 for t in tracks), default=0) + 1)
        await _write_tags(dest, values)
    except BaseException:
        await give_up()
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
        looked_up_by = {"title", "artist"} & values.keys()
        await _reimport(session, settings, [track.path], lyrics=bool(looked_up_by))
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
        new_folder = _new_album_folder(settings, new.artist, new.title)

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
        await session.commit()
        await _prune(settings, left)
    result = target.id if target is not None else imported[0].album.id
    return await _album_out(session, admin, result)


@manage_router.post("/albums/move", response_model=ArtistOut)
async def move_albums(
    body: AlbumsMove, session: SessionDep, settings: SettingsDep, admin: AdminUser
) -> ArtistOut:
    """Gives albums to another artist, one of the library or a new one: in their tracks'
    tags the album artist changes, and so does the track artist where it was the album's
    ("feat." in titles too). An album with the title of one of theirs is merged into it. The
    files stay where they are. Returns that artist."""
    albums = await _albums(session, body.album_ids)
    new = body.artist
    moving = [a for a in albums if a.artist.name_key != name_key(new)]
    owner = {a.id: a.artist for a in moving}
    tracks = await _tracks(session, Track.album_id.in_(list(owner)))

    def values(track: Track) -> Values:
        old = owner[track.album_id]
        changed: dict[str, str | list[str] | None] = {"albumartist": new}
        if any(c.artist_id == old.id for c in track.credits):
            names = [new if c.artist_id == old.id else c.artist.name for c in track.credits]
            changed["artist"] = _unique(names)
            if (title := rename_featured(track.title, old.name, new)) != track.title:
                changed["title"] = title
        return changed

    await _retag(session, settings, tracks, values)
    artist_id = await upsert_artist(session, new)
    for album in moving:
        twin = await session.scalar(
            select(Album).where(
                Album.artist_id == artist_id,
                Album.title_key == album.title_key,
                Album.id != album.id,
            )
        )
        if twin is None:
            album.artist_id = artist_id
        else:
            await _move_likes(session, AlbumLike.album_id, album.id, twin.id)
        await session.flush()
    await _reimport(session, settings, [t.path for t in tracks])
    await session.commit()
    artist = await session.scalar(
        select(Artist).where(Artist.id == artist_id).execution_options(populate_existing=True)
    )
    assert artist is not None
    return (await artists_out(session, admin.id, [artist]))[0]


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
    artist = await _artist(session, artist_id)
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

    in_step = await _retag(session, settings, tracks, values)
    other = await session.scalar(
        select(Artist).where(Artist.name_key == name_key(new), Artist.id != artist.id)
    )
    if other is None:
        # Renamed on the spot: the tracks keep their artists and albums, only titles with
        # "feat." change. That and the files' size and time are recorded here, without an
        # import of each file (but a file changed on the disk since the last scan).
        artist.name, artist.name_key = new, name_key(new)
        result = artist
        same = [t for t in tracks if t.id in in_step]
        for track in same:
            track.title = rename_featured(track.title, old, new)
        await _restat(session, settings, same)
        await _look_up_lyrics(session, same)
        again = [t.path for t in tracks if t.id not in in_step]
    else:
        await _merge_artist(session, artist, other)
        result = other
        again = [t.path for t in tracks]
    await session.flush()
    await _reimport(session, settings, again)
    await session.commit()
    await session.refresh(result)
    return (await artists_out(session, admin.id, [result]))[0]


@manage_router.delete("/artists/{artist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artist(
    artist_id: uuid.UUID, session: SessionDep, settings: SettingsDep, _: AdminUser
) -> None:
    """Deletes from the disk the files of the artist's tracks and of their albums (and the
    folders left without music). Tracks of others that only feature them stay: the artist
    leaves their tags ("feat." in titles too). To keep the tracks, give them to another
    artist instead: rename_artist with that one's name."""
    artist = await _artist(session, artist_id)
    theirs = select(Album.id).where(Album.artist_id == artist.id)
    doomed = await _tracks(session, (Track.artist_id == artist.id) | Track.album_id.in_(theirs))
    credited = select(TrackArtist.track_id).where(TrackArtist.artist_id == artist.id)
    featuring = await _tracks(
        session, Track.id.in_(credited), Track.id.not_in([t.id for t in doomed])
    )

    def uncredited(track: Track) -> Values:
        changed: dict[str, str | list[str] | None] = {
            "artist": [c.artist.name for c in track.credits if c.artist_id != artist.id]
        }
        if (title := remove_featured(track.title, artist.name)) != track.title:
            changed["title"] = title
        return changed

    # First, so nothing is deleted if their name can't leave those tracks' files.
    await _retag(session, settings, featuring, uncredited)
    await _reimport(session, settings, [t.path for t in featuring])
    await _delete_files(session, settings, doomed)


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
    if other.cover_id is None:
        other.cover_id = artist.cover_id


# --- genres --------------------------------------------------------------------------------


async def _genre_albums(session: AsyncSession, genre: str) -> list[Album]:
    """The genre's albums; spellings differing only in case are one genre, as in the list."""
    albums = list(
        await session.scalars(
            select(Album).where(func.lower(Album.genre) == genre.casefold()).options(*ALBUM_LOAD)
        )
    )
    if not albums:
        raise ApiError(ErrorCode.genre_not_found)
    return albums


async def _genre_out(session: AsyncSession, name: str) -> GenreOut:
    count = await session.scalar(
        select(func.count()).select_from(Album).where(func.lower(Album.genre) == name.casefold())
    )
    return GenreOut(name=name, album_count=count or 0)


async def _set_genre(
    session: AsyncSession, settings: Settings, albums: list[Album], genre: str | None
) -> None:
    """Writes the genre (None takes it off) into the tags of the albums' tracks. The genre
    is the album's, set here: of the tracks only their files' size and time change, so
    those are all that is recorded, unless a file had changed on the disk before (that one
    is imported again)."""
    changing = [a for a in albums if a.genre != genre]
    tracks = await _tracks(session, Track.album_id.in_([a.id for a in changing]))
    in_step = await _retag(session, settings, tracks, lambda _: {"genre": genre})
    for album in changing:
        album.genre = genre
    await _restat(session, settings, [t for t in tracks if t.id in in_step])
    await session.flush()
    others = [t.path for t in tracks if t.id not in in_step]
    await _reimport(session, settings, others, lyrics=False)
    await session.commit()


@manage_router.patch("/genres", response_model=GenreOut)
async def rename_genre(
    genre: Annotated[str, Query(min_length=1)],
    body: GenrePatch,
    session: SessionDep,
    settings: SettingsDep,
    _: AdminUser,
) -> GenreOut:
    """Renames the genre in the tags of its albums' tracks. The name of another genre merges
    the two."""
    await _set_genre(session, settings, await _genre_albums(session, genre), body.name)
    return await _genre_out(session, body.name)


@manage_router.post("/albums/genre", response_model=GenreOut)
async def set_albums_genre(
    body: AlbumsGenre, session: SessionDep, settings: SettingsDep, _: AdminUser
) -> GenreOut:
    """Moves albums into a genre, one of the library or a new one: in their tracks' tags.
    Returns that genre."""
    await _set_genre(session, settings, await _albums(session, body.album_ids), body.genre)
    return await _genre_out(session, body.genre)


@manage_router.delete("/genres", status_code=status.HTTP_204_NO_CONTENT)
async def delete_genre(
    genre: Annotated[str, Query(min_length=1)],
    albums: Annotated[GenreDeletion, Query()],
    session: SessionDep,
    settings: SettingsDep,
    _: AdminUser,
) -> None:
    """`albums=keep` takes the genre off its albums' tracks; `albums=delete` deletes their
    files from the disk (and the folders left without music)."""
    found = await _genre_albums(session, genre)
    if albums == GenreDeletion.keep:
        await _set_genre(session, settings, found, None)
    else:
        tracks = await _tracks(session, Track.album_id.in_([a.id for a in found]))
        await _delete_files(session, settings, tracks)
