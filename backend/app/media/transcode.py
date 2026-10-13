"""Renders Opus variants of a track with ffmpeg (runs inside the job worker)."""

import asyncio
import os
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy.dialects.postgresql import insert

from app.jobs.context import JobContext
from app.library.importer import resolve_in_library
from app.library.models import VARIANT_BITRATES, Track, TrackFile, Variant

OPUS_MIME = "audio/ogg; codecs=opus"


class TranscodeError(Exception):
    pass


def variant_path(transcodes_path: Path, track_id: uuid.UUID, variant: Variant) -> Path:
    hex_id = track_id.hex
    return transcodes_path / hex_id[:2] / f"{hex_id}_{variant.value}.opus"


async def run_ffmpeg(src: Path, dst: Path, bitrate_kbps: int) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".part")
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(src),
        "-map",
        "0:a:0",
        "-map_metadata",
        "-1",
        "-vn",
        "-c:a",
        "libopus",
        "-b:a",
        f"{bitrate_kbps}k",
        "-vbr",
        "on",
        "-f",
        "ogg",
        str(tmp),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise TranscodeError(stderr.decode(errors="replace").strip() or "ffmpeg failed")
    os.replace(tmp, dst)


def needed_variants(track: Track) -> list[Variant]:
    """Skips variants that would not be smaller than the source (e.g. a 96k Opus original)."""
    if track.codec == "opus" and track.bitrate is not None:
        return [v for v, kbps in VARIANT_BITRATES.items() if kbps < track.bitrate]
    return list(Variant)


async def transcode_track(ctx: JobContext, payload: dict[str, Any]) -> None:
    track_id = uuid.UUID(payload["track_id"])
    async with ctx.sessionmaker() as session:
        track = await session.get(Track, track_id)
        if track is None:
            return
        src = resolve_in_library(ctx.settings.library_path, track.path)

        for variant in needed_variants(track):
            dst = variant_path(ctx.settings.transcodes_path, track.id, variant)
            bitrate = VARIANT_BITRATES[variant]
            await run_ffmpeg(src, dst, bitrate)
            values = {
                "path": str(dst.relative_to(ctx.settings.transcodes_path)),
                "mime": OPUS_MIME,
                "bitrate": bitrate,
                "size": dst.stat().st_size,
            }
            await session.execute(
                insert(TrackFile)
                .values(id=uuid.uuid4(), track_id=track.id, variant=variant, **values)
                .on_conflict_do_update(constraint="uq_track_files_track_variant", set_=values)
            )
        await session.commit()
