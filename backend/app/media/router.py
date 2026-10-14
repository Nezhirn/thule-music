import asyncio
import enum
import mimetypes
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.deps import CurrentUser, OptionalUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode
from app.jobs.queue import enqueue, enqueue_many
from app.library.covers import COVER_SIZES, cover_file
from app.library.importer import resolve_in_library
from app.library.models import VARIANT_BITRATES, Album, Cover, Track, TrackFile, Variant
from app.media import signing
from app.schemas import ApiModel

router = APIRouter(tags=["media"])

AUDIO_MIME = {
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg; codecs=opus",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".wav": "audio/wav",
    ".wma": "audio/x-ms-wma",
}


class Quality(enum.StrEnum):
    original = "original"
    high = "high"  # Opus 160k
    low = "low"  # Opus 96k


class StreamUrl(ApiModel):
    # Path + query, without scheme and host: resolve it against the server address.
    url: str
    quality: Quality
    # What the URL plays: "opus" for a transcode, the file's codec for the original.
    codec: str
    bitrate: int | None  # kbit/s
    expires_at: datetime


@router.get("/tracks/{track_id}/stream-url", response_model=StreamUrl)
async def get_stream_url(
    track_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    _: CurrentUser,
    quality: Quality = Quality.high,
) -> StreamUrl:
    """Returns a signed URL that plays without an Authorization header. It is relative to
    the server (`/api/v1/tracks/...`): an absolute one would be built from the request's
    Host and scheme, which a reverse proxy may not pass through.

    The URL is pinned to a rendition that exists right now: if the requested transcode is
    not ready yet, it points at the original. Otherwise a transcode finishing mid-playback
    would make later Range requests read a different file."""
    track = await session.get(Track, track_id)
    if track is None:
        raise ApiError(ErrorCode.track_not_found)
    if quality != Quality.original:
        variant = await session.scalar(
            select(TrackFile).where(
                TrackFile.track_id == track_id, TrackFile.variant == Variant(quality.value)
            )
        )
        if variant is None:
            quality = Quality.original
        elif not await asyncio.to_thread((settings.transcodes_path / variant.path).is_file):
            # Its file lost (the data folder not restored with the database): made again.
            await session.delete(variant)
            key = f"transcode:{track_id}"
            await enqueue(session, "transcode", {"track_id": str(track_id)}, dedupe_key=key)
            await session.commit()
            quality = Quality.original
    expires, sig = signing.sign(
        settings.secret_key, track_id, quality.value, settings.stream_url_ttl_seconds
    )
    url = request.url_for("stream_track", track_id=track_id).include_query_params(
        quality=quality.value, exp=expires, sig=sig
    )
    transcoded = quality != Quality.original
    return StreamUrl(
        url=f"{url.path}?{url.query}",
        quality=quality,
        codec="opus" if transcoded else track.codec,
        bitrate=VARIANT_BITRATES[Variant(quality.value)] if transcoded else track.bitrate,
        expires_at=datetime.fromtimestamp(expires, UTC),
    )


@router.get("/tracks/{track_id}/stream", response_class=FileResponse)
async def stream_track(
    track_id: uuid.UUID,
    session: SessionDep,
    settings: SettingsDep,
    user: OptionalUser,
    quality: Quality = Quality.high,
    exp: Annotated[int | None, Query()] = None,
    sig: Annotated[str | None, Query()] = None,
) -> FileResponse:
    """Streams audio with HTTP Range support. Auth: Bearer header or `exp`+`sig` from
    `/stream-url`. `high`/`low` fall back to the original until the transcode is ready."""
    if user is None and (
        exp is None
        or sig is None
        or not signing.verify(settings.secret_key, track_id, quality.value, exp, sig)
    ):
        raise ApiError(ErrorCode.invalid_stream_signature)

    track = await session.get(Track, track_id)
    if track is None:
        raise ApiError(ErrorCode.track_not_found)

    if quality != Quality.original:
        variant = await session.scalar(
            select(TrackFile).where(
                TrackFile.track_id == track_id, TrackFile.variant == Variant(quality.value)
            )
        )
        if variant is not None:
            path = settings.transcodes_path / variant.path
            if path.is_file():
                return FileResponse(
                    path,
                    media_type=variant.mime,
                    headers={
                        "Cache-Control": "private, max-age=86400",
                        "X-Thule-Quality": quality.value,
                    },
                )

    path = resolve_in_library(settings.library_path, track.path)
    if not path.is_file():
        raise ApiError(ErrorCode.audio_file_missing)
    media_type = AUDIO_MIME.get(path.suffix.casefold()) or (
        mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    )
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Thule-Quality": Quality.original.value,
        },
    )


@router.get("/covers/{cover_id}", response_class=FileResponse)
async def get_cover(
    cover_id: uuid.UUID,
    session: SessionDep,
    settings: SettingsDep,
    size: Annotated[
        int | None, Query(description=f"One of {COVER_SIZES}; omit for full size")
    ] = None,
) -> FileResponse:
    """Public (no auth) so `<img src>` works; ids are unguessable UUIDs."""
    if size is not None and size not in COVER_SIZES:
        raise ApiError(ErrorCode.invalid_cover_size, f"size must be one of {COVER_SIZES}")
    cover = await session.get(Cover, cover_id)
    if cover is None:
        raise ApiError(ErrorCode.cover_not_found)
    path = cover_file(settings.covers_path, cover, size)
    if not await asyncio.to_thread(path.is_file):
        # Lost (a database restored without the data folder): the albums showing it choose
        # it again from their files. A cover an admin chose is gone with the folder.
        albums = await session.scalars(
            select(Album.id).where(Album.cover_id == cover_id, ~Album.cover_custom)
        )
        await enqueue_many(
            session, "album_cover", [({"album_id": str(a)}, f"cover:{a}") for a in albums]
        )
        await session.commit()
        raise ApiError(ErrorCode.cover_file_missing)
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
