"""Renders Opus variants of a track with ffmpeg (runs inside the job worker)."""

import asyncio
import contextlib
import os
import time
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.dialects.postgresql import insert

from app.jobs.context import JobContext
from app.library.importer import resolve_in_library
from app.library.models import VARIANT_BITRATES, Track, TrackFile, Variant

OPUS_MIME = "audio/ogg; codecs=opus"

# An encode slower than real time (plus a minute of slack) is treated as hung and killed,
# and the whole job within this.
JOB_BUDGET = timedelta(minutes=25)


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
    try:
        _, stderr = await proc.communicate()
    except BaseException:  # cancelled (timeout, shutdown): don't leave ffmpeg running
        with contextlib.suppress(ProcessLookupError):
            proc.kill()
        await proc.wait()
        tmp.unlink(missing_ok=True)
        raise
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise TranscodeError(stderr.decode(errors="replace").strip() or "ffmpeg failed")
    os.replace(tmp, dst)


def needed_variants(track: Track) -> list[Variant]:
    """Skips variants that would not be smaller than the source (e.g. a 96k Opus original)."""
    if track.codec == "opus" and track.bitrate is not None:
        return [v for v, kbps in VARIANT_BITRATES.items() if kbps < track.bitrate]
    return list(Variant)


class SourceChanged(Exception):
    """The audio file changed while it was encoded: the job runs again for the new one."""


def _source_stat(src: Path) -> tuple[int, float]:
    st = src.stat()
    return st.st_size, st.st_mtime


async def transcode_track(ctx: JobContext, payload: dict[str, Any]) -> None:
    track_id = uuid.UUID(payload["track_id"])
    # No transaction is held while ffmpeg runs, which may take many minutes.
    async with ctx.sessionmaker() as session:
        track = await session.get(Track, track_id)
        if track is None:
            return
        rel, duration_ms, variants = track.path, track.duration_ms, needed_variants(track)
    src = resolve_in_library(ctx.settings.library_path, rel)
    before = await asyncio.to_thread(_source_stat, src)
    deadline = time.monotonic() + JOB_BUDGET.total_seconds()

    rendered = []
    for variant in variants:
        dst = variant_path(ctx.settings.transcodes_path, track_id, variant)
        bitrate = VARIANT_BITRATES[variant]
        timeout = min(60 + duration_ms / 1000, deadline - time.monotonic())
        try:
            async with asyncio.timeout(max(timeout, 0)):
                await run_ffmpeg(src, dst, bitrate)
        except TimeoutError:
            raise TranscodeError(f"ffmpeg did not finish within {timeout:.0f} s") from None
        rendered.append((variant, dst, bitrate, (await asyncio.to_thread(dst.stat)).st_size))

    # A new file in its place meanwhile (replaced, re-tagged): the variants are of the old
    # one, and its own transcode was skipped as this one was running.
    if await asyncio.to_thread(_source_stat, src) != before:
        raise SourceChanged(f"{rel} changed while it was transcoded")
    async with ctx.sessionmaker() as session:
        track = await session.get(Track, track_id)
        if track is None or track.path != rel:
            return
        for variant, dst, bitrate, size in rendered:
            values = {
                "path": str(dst.relative_to(ctx.settings.transcodes_path)),
                "mime": OPUS_MIME,
                "bitrate": bitrate,
                "size": size,
            }
            await session.execute(
                insert(TrackFile)
                .values(id=uuid.uuid4(), track_id=track_id, variant=variant, **values)
                .on_conflict_do_update(constraint="uq_track_files_track_variant", set_=values)
            )
        await session.commit()
