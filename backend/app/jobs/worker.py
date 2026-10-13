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
from app.jobs.queue import claim, mark_done, mark_failed
from app.library.covers import backfill_palettes
from app.library.importer import import_track, refresh_album_cover, scan_library
from app.lyrics.fetch import fetch_lyrics
from app.media.transcode import transcode_track

log = logging.getLogger("thule.worker")

Handler = Callable[[JobContext, dict[str, Any]], Awaitable[None]]

HANDLERS: dict[str, Handler] = {
    "scan_library": scan_library,
    "import_track": import_track,
    "transcode": transcode_track,
    "fetch_lyrics": fetch_lyrics,
    "cover_palettes": backfill_palettes,
    "album_cover": refresh_album_cover,
    "housekeeping": housekeeping,
}


async def run_one(ctx: JobContext) -> bool:
    """Runs a single job if one is available. Returns False when the queue is empty."""
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

    handler = HANDLERS.get(job.kind)
    try:
        if handler is None:
            raise LookupError(f"Unknown job kind: {job.kind}")
        await handler(ctx, job.payload)
    except Exception as exc:
        log.exception("job %s (%s) failed", job.id, job.kind)
        async with ctx.sessionmaker() as session:
            await mark_failed(session, job, f"{type(exc).__name__}: {exc}")
    else:
        async with ctx.sessionmaker() as session:
            await mark_done(session, job)
    return True


async def drain(ctx: JobContext, max_jobs: int = 10_000) -> int:
    """Runs jobs until the queue is empty (used by tests and one-shot CLI runs)."""
    count = 0
    while count < max_jobs and await run_one(ctx):
        count += 1
    return count


async def main(settings: Settings, concurrency: int = 2) -> None:
    engine = make_engine(settings.database_url, settings.db_schema, pool_size=concurrency + 1)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    async with httpx.AsyncClient() as http:
        ctx = JobContext(settings, make_sessionmaker(engine), http)

        async def loop_worker(n: int) -> None:
            while not stop.is_set():
                try:
                    busy = await run_one(ctx)
                except Exception:
                    log.exception("worker %d: queue error", n)
                    busy = False
                if not busy:
                    with contextlib.suppress(TimeoutError):
                        await asyncio.wait_for(stop.wait(), settings.worker_poll_interval_seconds)

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
