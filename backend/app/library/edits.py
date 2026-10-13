"""Admins' corrections of what the files say about a cover: an album's chosen by hand, a
picture of a track's own, an artist's picture. Lyrics are corrected in app.lyrics.router."""

import uuid

from fastapi import APIRouter, UploadFile
from sqlalchemy import select

from app.config import Settings
from app.deps import AdminUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode
from app.library.covers import MAX_COVER_BYTES, store_cover
from app.library.importer import choose_album_cover
from app.library.models import Album, Artist, Cover, Track
from app.library.queries import ALBUM_LOAD, albums_out, artists_out, track_select, tracks_out
from app.schemas import AlbumOut, ArtistOut, TrackOut

edits_router = APIRouter(tags=["admin"])


async def _picture(session: SessionDep, settings: Settings, file: UploadFile) -> Cover:
    data = await file.read(MAX_COVER_BYTES + 1)
    if len(data) > MAX_COVER_BYTES:
        raise ApiError(ErrorCode.image_too_large)
    cover = await store_cover(session, settings.covers_path, data)
    if cover is None:
        raise ApiError(ErrorCode.not_an_image)
    return cover


async def _album(session: SessionDep, album_id: uuid.UUID) -> Album:
    album = await session.get(Album, album_id)
    if album is None:
        raise ApiError(ErrorCode.album_not_found)
    return album


async def _album_out(session: SessionDep, admin: AdminUser, album_id: uuid.UUID) -> AlbumOut:
    album = await session.scalar(
        select(Album)
        .where(Album.id == album_id)
        .options(*ALBUM_LOAD)
        .execution_options(populate_existing=True)
    )
    assert album is not None
    (out,) = await albums_out(session, admin.id, [album])
    return out


async def _track(session: SessionDep, track_id: uuid.UUID) -> Track:
    track = await session.get(Track, track_id)
    if track is None:
        raise ApiError(ErrorCode.track_not_found)
    return track


async def _track_out(session: SessionDep, admin: AdminUser, track_id: uuid.UUID) -> TrackOut:
    track = await session.scalar(
        track_select().where(Track.id == track_id).execution_options(populate_existing=True)
    )
    assert track is not None
    (out,) = await tracks_out(session, admin.id, [track])
    return out


@edits_router.put("/albums/{album_id}/cover", response_model=AlbumOut)
async def set_album_cover(
    album_id: uuid.UUID,
    file: UploadFile,
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
) -> AlbumOut:
    """JPEG, PNG or WebP up to 20 MB. Scans keep it whatever the album's files hold, until
    `DELETE` gives it up."""
    album = await _album(session, album_id)
    cover = await _picture(session, settings, file)
    album.cover_id, album.cover_custom = cover.id, True
    album.cover_source = album.cover_mtime = None
    await session.commit()
    return await _album_out(session, admin, album_id)


@edits_router.delete("/albums/{album_id}/cover", response_model=AlbumOut)
async def reset_album_cover(
    album_id: uuid.UUID, session: SessionDep, settings: SettingsDep, admin: AdminUser
) -> AlbumOut:
    """Gives up the cover an admin chose: the album's files have the say again (a folder
    image, else embedded art)."""
    album = await _album(session, album_id)
    album.cover_custom = False
    await session.flush()
    await choose_album_cover(session, settings.library_path, settings.covers_path, album)
    await session.commit()
    return await _album_out(session, admin, album_id)


@edits_router.put("/tracks/{track_id}/cover", response_model=TrackOut)
async def set_track_cover(
    track_id: uuid.UUID,
    file: UploadFile,
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
) -> TrackOut:
    """The track's own picture, shown instead of its album's cover wherever the track is
    (lists, the player, playlists' mosaics). JPEG, PNG or WebP up to 20 MB."""
    track = await _track(session, track_id)
    track.cover_id = (await _picture(session, settings, file)).id
    await session.commit()
    return await _track_out(session, admin, track_id)


@edits_router.delete("/tracks/{track_id}/cover", response_model=TrackOut)
async def reset_track_cover(track_id: uuid.UUID, session: SessionDep, admin: AdminUser) -> TrackOut:
    """The track shows its album's cover again."""
    track = await _track(session, track_id)
    track.cover_id = None
    await session.commit()
    return await _track_out(session, admin, track_id)


async def _artist(session: SessionDep, artist_id: uuid.UUID) -> Artist:
    artist = await session.get(Artist, artist_id)
    if artist is None:
        raise ApiError(ErrorCode.artist_not_found)
    return artist


@edits_router.put("/artists/{artist_id}/cover", response_model=ArtistOut)
async def set_artist_cover(
    artist_id: uuid.UUID,
    file: UploadFile,
    session: SessionDep,
    settings: SettingsDep,
    admin: AdminUser,
) -> ArtistOut:
    """The artist's picture, instead of their newest album's cover. JPEG, PNG or WebP up to
    20 MB. Kept on the server: the files have no place for it."""
    artist = await _artist(session, artist_id)
    artist.cover_id = (await _picture(session, settings, file)).id
    await session.commit()
    (out,) = await artists_out(session, admin.id, [artist])
    return out


@edits_router.delete("/artists/{artist_id}/cover", response_model=ArtistOut)
async def reset_artist_cover(
    artist_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> ArtistOut:
    """The artist shows their newest album's cover again."""
    artist = await _artist(session, artist_id)
    artist.cover_id = None
    await session.commit()
    (out,) = await artists_out(session, admin.id, [artist])
    return out
