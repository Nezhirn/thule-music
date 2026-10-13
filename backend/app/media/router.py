import enum
import mimetypes
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from app.deps import CurrentUser, OptionalUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode
from app.library.covers import COVER_SIZES, cover_file
from app.library.importer import resolve_in_library
from app.library.models import Cover, Track, TrackFile, Variant
from app.media import signing

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


class StreamUrl(BaseModel):
    # Path + query, without scheme and host: resolve it against the server address.
    url: str
    quality: Quality
    expires_at: datetime


@router.get("/tracks/{track_id}/stream-url", response_model=StreamUrl)
async def stream_url(
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
    if await session.get(Track, track_id) is None:
        raise ApiError(ErrorCode.track_not_found)
    if quality != Quality.original and not await session.scalar(
        select(TrackFile.id).where(
            TrackFile.track_id == track_id, TrackFile.variant == Variant(quality.value)
        )
    ):
        quality = Quality.original
    expires, sig = signing.sign(
        settings.secret_key, track_id, quality.value, settings.stream_url_ttl_seconds
    )
    url = request.url_for("stream", track_id=track_id).include_query_params(
        quality=quality.value, exp=expires, sig=sig
    )
    return StreamUrl(
        url=f"{url.path}?{url.query}",
        quality=quality,
        expires_at=datetime.fromtimestamp(expires, UTC),
    )


@router.get("/tracks/{track_id}/stream", name="stream", response_class=FileResponse)
async def stream(
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
    if not path.is_file():
        raise ApiError(ErrorCode.cover_file_missing)
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
