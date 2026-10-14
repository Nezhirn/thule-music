"""Periodic clean-up (job `housekeeping`) of what finished work, deletes and re-imports leave
behind: old job rows, expired refresh tokens, unused covers, orphaned files."""

import asyncio
import contextlib
import logging
import os
import time
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import and_, delete, exists, func, or_, select

from app.auth.models import LoginFailure, RefreshToken, User
from app.db import utcnow
from app.jobs.context import JobContext
from app.jobs.models import Job, JobStatus
from app.jobs.queue import enqueue
from app.library.covers import COVERS_LOCK
from app.library.models import Album, Artist, Cover, Track, TrackFile

log = logging.getLogger(__name__)

KEEP_DONE_JOBS = timedelta(days=7)
KEEP_FAILED_JOBS = timedelta(days=30)
# A file this young may belong to work in flight (a transcode is renamed into place before
# its row is committed, cover thumbnails are written before theirs), so it is left alone.
FILE_GRACE = timedelta(hours=1)


# Files that no row knows of are removed only when that is the odd file, not most of them:
# with the database empty, or another one (being restored, a wrong address), every file would
# look unused, and the cover files are the only copy of covers admins chose and of avatars.
SWEEP_LIMIT = 20


def _sweep(directory: Path, keep: Callable[[str], bool], *, guard: bool) -> int:
    """Deletes the files under `directory` that `keep(relative path)` rejects. With `guard`,
    none when they are more than SWEEP_LIMIT and half of the files."""
    cutoff = time.time() - FILE_GRACE.total_seconds()
    total, unused = 0, []
    for dirpath, _, filenames in os.walk(directory):
        for name in filenames:
            total += 1
            full = Path(dirpath, name)
            if keep(full.relative_to(directory).as_posix()):
                continue
            try:
                if full.stat().st_mtime < cutoff:
                    unused.append(full)
            except OSError:
                continue
    if guard and len(unused) > SWEEP_LIMIT and len(unused) * 2 > total:
        log.warning(
            "housekeeping: %d of %d files in %s are unknown to the database; none removed "
            "(is it the right database?)",
            len(unused),
            total,
            directory,
        )
        return 0
    removed = 0
    for full in unused:
        with contextlib.suppress(OSError):
            full.unlink()
            removed += 1
    return removed


def _remove_cover_files(covers_path: Path, hashes: set[str]) -> int:
    """The files of covers whose rows were just deleted."""
    removed = 0
    for source_hash in hashes:
        for full in (covers_path / source_hash[:2]).glob(f"{source_hash}*.jpg"):
            with contextlib.suppress(OSError):
                full.unlink()
                removed += 1
    return removed


def _cover_hash(rel: str) -> str:
    """'ab/<sha256>_300.jpg' -> '<sha256>'."""
    return rel.rsplit("/", 1)[-1].split(".", 1)[0].split("_", 1)[0]


async def housekeeping(ctx: JobContext, payload: dict[str, Any]) -> None:
    now = utcnow()
    async with ctx.sessionmaker() as session:
        # The latest scan stays however old: the admin page shows what it found.
        last_scan = (
            select(Job.id)
            .where(Job.kind == "scan_library", Job.status == JobStatus.done)
            .order_by(Job.finished_at.desc())
            .limit(1)
            .scalar_subquery()
        )
        jobs = await session.execute(
            delete(Job).where(
                or_(
                    and_(Job.status == JobStatus.done, Job.finished_at < now - KEEP_DONE_JOBS),
                    and_(Job.status == JobStatus.failed, Job.finished_at < now - KEEP_FAILED_JOBS),
                ),
                Job.id.is_distinct_from(last_scan),
            )
        )
        tokens = await session.execute(delete(RefreshToken).where(RefreshToken.expires_at < now))
        await session.execute(
            delete(LoginFailure).where(LoginFailure.failed_at < now - timedelta(days=1))
        )
        # Waits for imports that may be about to reference an existing cover (store_cover).
        await session.execute(select(func.pg_advisory_xact_lock(COVERS_LOCK)))
        unused = set(
            await session.scalars(
                delete(Cover)
                .where(
                    ~exists().where(Album.cover_id == Cover.id),
                    ~exists().where(Track.cover_id == Cover.id),
                    ~exists().where(Artist.cover_id == Cover.id),
                    ~exists().where(User.avatar_id == Cover.id),
                )
                .returning(Cover.source_hash)
            )
        )
        await session.commit()
        transcodes = set(await session.scalars(select(TrackFile.path)))
        hashes = set(await session.scalars(select(Cover.source_hash)))
        any_tracks = await session.scalar(select(exists().where(Track.id.is_not(None))))

    settings = ctx.settings
    cover_files = await asyncio.to_thread(_remove_cover_files, settings.covers_path, unused)
    # Transcodes can be made again: they go unless the database has no tracks at all.
    if any_tracks:
        transcode_files = await asyncio.to_thread(
            _sweep, settings.transcodes_path, transcodes.__contains__, guard=False
        )
    else:
        transcode_files = 0
    if hashes:
        cover_files += await asyncio.to_thread(
            _sweep, settings.covers_path, lambda rel: _cover_hash(rel) in hashes, guard=True
        )
    log.info(
        "housekeeping: %d jobs, %d refresh tokens, %d covers, %d transcode files, "
        "%d cover files removed",
        jobs.rowcount,  # type: ignore[attr-defined]
        tokens.rowcount,  # type: ignore[attr-defined]
        len(unused),
        transcode_files,
        cover_files,
    )


async def schedule_housekeeping(ctx: JobContext) -> bool:
    """Queues housekeeping unless it was queued within the interval; with several workers
    each calls this, so the check keeps it to one run per interval. True if queued."""
    interval = timedelta(seconds=ctx.settings.housekeeping_interval_seconds)
    async with ctx.sessionmaker() as session:
        recent = await session.scalar(
            select(exists().where(Job.kind == "housekeeping", Job.created_at > utcnow() - interval))
        )
        if recent:
            return False
        await enqueue(session, "housekeeping", dedupe_key="housekeeping")
        await session.commit()
    return True
