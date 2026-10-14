"""Postgres-backed job queue (`SELECT ... FOR UPDATE SKIP LOCKED`). No Redis needed."""

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.jobs.models import Job, JobStatus

# A running job's worker says it is alive this often (see the worker's heartbeat); a job
# not heard of for STALE_AFTER had its worker die (killed, out of memory, the container
# stopped) and is taken again.
HEARTBEAT = timedelta(minutes=1)
STALE_AFTER = timedelta(minutes=5)


class PermanentFailure(Exception):
    """A failure that trying again won't fix, e.g. a file that is not audio: the job fails
    at once instead of being retried."""


class Postpone(Exception):  # noqa: N818 - not an error: the job asks to run later
    """Not now: something the job needs is away for a while (a web service down). The job
    runs again at `until` without that counting as an attempt."""

    def __init__(self, until: datetime, reason: str) -> None:
        super().__init__(reason)
        self.until = until


# Skips a job whose dedupe_key is already queued or running.
_INSERT_JOB = insert(Job).on_conflict_do_nothing(
    index_elements=[Job.dedupe_key],
    index_where=text("status IN ('queued', 'running') AND dedupe_key IS NOT NULL"),
)


async def enqueue(
    session: AsyncSession,
    kind: str,
    payload: dict[str, Any] | None = None,
    *,
    dedupe_key: str | None = None,
    max_attempts: int = 3,
) -> None:
    """Adds a job within the caller's transaction (caller commits). If a job with the same
    dedupe_key is already queued or running, this is a no-op."""
    await enqueue_many(session, kind, [(payload or {}, dedupe_key)], max_attempts=max_attempts)


async def enqueue_many(
    session: AsyncSession,
    kind: str,
    jobs: list[tuple[dict[str, Any], str | None]],
    *,
    max_attempts: int = 3,
) -> None:
    """Like `enqueue` for many (payload, dedupe_key) pairs, in one batched statement: a scan
    queues thousands of imports, and a round trip each is slow on a remote database."""
    if not jobs:
        return
    rows = [
        {"kind": kind, "payload": payload, "dedupe_key": key, "max_attempts": max_attempts}
        for payload, key in jobs
    ]
    await session.execute(_INSERT_JOB, rows)


async def requeue(session: AsyncSession, jobs: list[Job]) -> None:
    """Runs failed jobs again: queues each afresh (skipped when the same work is already
    pending) and removes the failed one. Within the caller's transaction."""
    if not jobs:
        return
    rows, keys = [], set()
    for job in jobs:
        if job.dedupe_key is not None:
            if job.dedupe_key in keys:
                continue
            keys.add(job.dedupe_key)
        rows.append(
            {
                "kind": job.kind,
                "payload": job.payload,
                "dedupe_key": job.dedupe_key,
                "max_attempts": job.max_attempts,
            }
        )
    await session.execute(_INSERT_JOB, rows)
    await session.execute(delete(Job).where(Job.id.in_([job.id for job in jobs])))


async def claim(session: AsyncSession) -> Job | None:
    """Atomically takes the next runnable job and marks it running: one whose worker died
    first, else the queued one due longest. Commits. Two queries, each along its own
    partial index (one OR-ed query would read the whole table on every poll)."""
    now = utcnow()
    for runnable, order in (
        ((Job.status == JobStatus.running) & (Job.locked_at < now - STALE_AFTER), Job.locked_at),
        ((Job.status == JobStatus.queued) & (Job.run_after <= now), Job.run_after),
    ):
        candidate = (
            select(Job.id)
            .where(runnable)
            .order_by(order)
            .limit(1)
            .with_for_update(skip_locked=True)
            .scalar_subquery()
        )
        job = await session.scalar(
            update(Job)
            .where(Job.id == candidate)
            .values(status=JobStatus.running, locked_at=now, attempts=Job.attempts + 1)
            .returning(Job)
        )
        if job is not None:
            await session.commit()
            return job
    await session.commit()
    return None


def _ours(job: Job) -> Any:
    """The job as this worker claimed it: still running, and not claimed again since by
    another worker that took it for dead (each claim counts an attempt)."""
    return (Job.id == job.id) & (Job.status == JobStatus.running) & (Job.attempts == job.attempts)


async def touch(session: AsyncSession, job: Job) -> None:
    """The worker running the job is alive (see HEARTBEAT)."""
    await session.execute(update(Job).where(_ours(job)).values(locked_at=utcnow()))
    await session.commit()


async def mark_done(session: AsyncSession, job: Job, result: dict[str, Any] | None = None) -> None:
    await session.execute(
        update(Job)
        .where(_ours(job))
        .values(
            status=JobStatus.done, finished_at=utcnow(), error=None, locked_at=None, result=result
        )
    )
    await session.commit()


async def mark_failed(session: AsyncSession, job: Job, error: str, *, retry: bool = True) -> None:
    """Retries with exponential backoff until max_attempts, then fails permanently."""
    now = utcnow()
    if retry and job.attempts < job.max_attempts:
        values: dict[str, Any] = {
            "status": JobStatus.queued,
            "run_after": now + timedelta(seconds=10 * 2 ** (job.attempts - 1)),
        }
    else:
        values = {"status": JobStatus.failed, "finished_at": now}
    await session.execute(
        update(Job).where(_ours(job)).values(error=error[:4000], locked_at=None, **values)
    )
    await session.commit()


async def put_back(
    session: AsyncSession, job: Job, *, run_after: datetime | None = None, error: str | None = None
) -> None:
    """Back in the queue as it was before this attempt (its worker is stopping, or it asked
    to run later): the attempt doesn't count."""
    await session.execute(
        update(Job)
        .where(_ours(job))
        .values(
            status=JobStatus.queued,
            attempts=Job.attempts - 1,
            locked_at=None,
            run_after=run_after or utcnow(),
            error=error,
        )
    )
    await session.commit()
