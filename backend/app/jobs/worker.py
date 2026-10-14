"""Background job worker. Run with `python -m app.jobs.worker`."""

import asyncio
import contextlib
import logging
import signal
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.db import make_engine, make_sessionmaker
from app.jobs.context import JobContext
from app.jobs.housekeeping import housekeeping, schedule_housekeeping
from app.jobs.models import Job
from app.jobs.queue import (
    HEARTBEAT,
    PermanentFailure,
    Postpone,
    claim,
    mark_done,
    mark_failed,
    put_back,
    touch,
)
from app.library.covers import backfill_palettes
from app.library.importer import import_track, refresh_album_cover, scan_library
from app.lyrics.fetch import fetch_lyrics
from app.media.transcode import transcode_track

log = logging.getLogger("thule.worker")

# The longest pause between tries while the queue can't be read (the database away).
MAX_ERROR_PAUSE_SECONDS = 60.0

# A handler may return what it found (stored as the job's result).
Handler = Callable[[JobContext, dict[str, Any]], Awaitable[dict[str, Any] | None]]

HANDLERS: dict[str, Handler] = {
    "scan_library": scan_library,
    "import_track": import_track,
    "transcode": transcode_track,
    "fetch_lyrics": fetch_lyrics,
    "cover_palettes": backfill_palettes,
    "album_cover": refresh_album_cover,
    "housekeeping": housekeeping,
}


# Told to stop (SIGTERM: the container stopping), a job gets this long to finish; then it
# is stopped and goes back to the queue, where the next worker takes it at once. Docker
# waits stop_grace_period (see docker-compose.yml) before it kills the process.
SHUTDOWN_GRACE_SECONDS = 20.0


async def run_one(ctx: JobContext, stop: asyncio.Event | None = None) -> bool:
    """Runs a single job if one is available. Returns False when the queue is empty. With
    `stop` set meanwhile, the job is given SHUTDOWN_GRACE_SECONDS, then put back."""
    async with ctx.sessionmaker() as session:
        job = await claim(session)
    if job is None:
        return False
    if job.attempts > job.max_attempts:
        # Re-claimed as stale after its worker died mid-run (crash, OOM, kill) on every
        # attempt. Running it again would just take the next worker down too.
        async with ctx.sessionmaker() as session:
            await mark_failed(session, job, "Worker stopped while running this job")
        return True

    beat = asyncio.create_task(_heartbeat(ctx, job))
    work = asyncio.create_task(_run(ctx, job))
    try:
        if stop is not None and not await _finishes(work, stop):
            async with ctx.sessionmaker() as session:
                await put_back(session, job)
            log.info("job %s (%s) put back in the queue: the worker is stopping", job.id, job.kind)
            return True
        await work
    finally:
        beat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beat
    return True


async def _finishes(work: asyncio.Task[None], stop: asyncio.Event) -> bool:
    """Waits for the job. If the worker is told to stop meanwhile, the job has
    SHUTDOWN_GRACE_SECONDS more, then is cancelled: False."""
    stopping = asyncio.create_task(stop.wait())
    try:
        await asyncio.wait({work, stopping}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        stopping.cancel()
    if not work.done():
        await asyncio.wait({work}, timeout=SHUTDOWN_GRACE_SECONDS)
    if work.done():
        return True
    work.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await work
    return False


async def _heartbeat(ctx: JobContext, job: Job) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT.total_seconds())
        try:
            async with ctx.sessionmaker() as session:
                await touch(session, job)
        except Exception as exc:
            log.warning("job %s: heartbeat failed: %r", job.id, exc)


async def _run(ctx: JobContext, job: Job) -> None:
    handler = HANDLERS.get(job.kind)
    try:
        if handler is None:
            raise LookupError(f"Unknown job kind: {job.kind}")
        result = await handler(ctx, job.payload)
    except Postpone as later:
        log.info("job %s (%s) runs again at %s: %s", job.id, job.kind, later.until, later)
        async with ctx.sessionmaker() as session:
            await put_back(session, job, run_after=later.until, error=str(later))
    except PermanentFailure as exc:
        log.warning("job %s (%s) failed: %s", job.id, job.kind, exc)
        async with ctx.sessionmaker() as session:
            await mark_failed(session, job, str(exc), retry=False)
    except Exception as exc:
        log.exception("job %s (%s) failed", job.id, job.kind)
        async with ctx.sessionmaker() as session:
            await mark_failed(session, job, f"{type(exc).__name__}: {exc}")
    else:
        async with ctx.sessionmaker() as session:
            await mark_done(session, job, result)


async def drain(ctx: JobContext, max_jobs: int = 10_000) -> int:
    """Runs jobs until the queue is empty (used by tests and one-shot CLI runs)."""
    count = 0
    while count < max_jobs and await run_one(ctx):
        count += 1
    return count


async def main(settings: Settings, concurrency: int = 2) -> None:
    engine = make_engine(
        settings.database_url,
        settings.db_schema,
        pool_size=concurrency + 2,
        pool_pre_ping=True,
        pool_recycle=1800,
    )
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    async with httpx.AsyncClient() as http:
        ctx = JobContext(settings, make_sessionmaker(engine), http)

        async def loop_worker(n: int) -> None:
            failures = 0
            while not stop.is_set():
                try:
                    busy = await run_one(ctx, stop)
                    failures = 0
                except Exception as exc:
                    # The database away: said once in full, then briefly, ever less often.
                    failures += 1
                    if failures == 1:
                        log.exception("worker %d: queue error", n)
                    else:
                        log.warning("worker %d: queue error (%d in a row): %r", n, failures, exc)
                    busy = False
                if not busy:
                    pause = settings.worker_poll_interval_seconds
                    if failures:
                        pause = min(MAX_ERROR_PAUSE_SECONDS, pause * 2**failures)
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(stop.wait(), pause)

        async def loop_scheduler() -> None:
            while not stop.is_set():
                try:
                    await schedule_housekeeping(ctx)
                except Exception:
                    log.exception("scheduler error")
                with contextlib.suppress(TimeoutError):
                    await asyncio.wait_for(stop.wait(), 600)

        log.info("worker started (concurrency=%d)", concurrency)
        await asyncio.gather(loop_scheduler(), *(loop_worker(i) for i in range(concurrency)))
    await engine.dispose()
    log.info("worker stopped")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--concurrency", type=int, default=2)
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    asyncio.run(main(get_settings(), args.concurrency))
