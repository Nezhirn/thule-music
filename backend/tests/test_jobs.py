import asyncio
from datetime import timedelta

from sqlalchemy import event, select, update

from app.db import utcnow
from app.jobs import queue, worker
from app.jobs.models import Job, JobStatus
from app.jobs.queue import (
    STALE_AFTER,
    Postpone,
    claim,
    enqueue,
    enqueue_many,
    mark_done,
    mark_failed,
    touch,
)
from app.jobs.worker import HANDLERS, run_one


async def test_stale_job_is_retried_until_attempts_run_out(job_ctx, sessionmaker, monkeypatch):
    calls = []

    async def probe(ctx, payload):
        calls.append(payload)

    monkeypatch.setitem(HANDLERS, "probe", probe)
    stale = utcnow() - STALE_AFTER - timedelta(minutes=1)
    async with sessionmaker() as session:
        # Both workers died mid-run: one job has attempts left, the other does not.
        session.add_all(
            [
                Job(
                    kind="probe",
                    payload={"n": 1},
                    status=JobStatus.running,
                    attempts=2,
                    max_attempts=3,
                    locked_at=stale,
                    run_after=stale,
                ),
                Job(
                    kind="probe",
                    payload={"n": 2},
                    status=JobStatus.running,
                    attempts=3,
                    max_attempts=3,
                    locked_at=stale,
                    run_after=stale + timedelta(seconds=1),
                ),
            ]
        )
        await session.commit()

    assert await run_one(job_ctx)
    assert await run_one(job_ctx)
    assert not await run_one(job_ctx)

    assert calls == [{"n": 1}]
    async with sessionmaker() as session:
        jobs = {j.payload["n"]: j for j in await session.scalars(select(Job))}
    assert jobs[1].status == JobStatus.done
    assert jobs[2].status == JobStatus.failed
    assert jobs[2].error == "Worker stopped while running this job"


async def test_enqueue_many_is_one_statement_and_dedupes(sessionmaker, engine):
    async with sessionmaker() as session:
        await enqueue(session, "probe", {"n": 0}, dedupe_key="k0")
        await session.commit()

    statements = []

    def count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    try:
        async with sessionmaker() as session:
            jobs = [({"n": i}, f"k{i}") for i in range(500)] + [({"n": 1}, "k1")]
            await enqueue_many(session, "probe", jobs)
            await session.commit()
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", count)

    assert len([s for s in statements if s.startswith("INSERT")]) == 1
    async with sessionmaker() as session:
        keys = list(await session.scalars(select(Job.dedupe_key)))
    assert sorted(keys) == sorted(f"k{i}" for i in range(500))  # k0 and k1 only once


async def add_job(sessionmaker, kind: str = "probe") -> None:
    async with sessionmaker() as session:
        await enqueue(session, kind, {"n": 1})
        await session.commit()


async def the_job(sessionmaker) -> Job:
    async with sessionmaker() as session:
        return (await session.scalars(select(Job))).one()


async def test_a_long_job_stays_its_workers_while_it_beats(job_ctx, sessionmaker, monkeypatch):
    monkeypatch.setattr(queue, "STALE_AFTER", timedelta(seconds=0.5))
    monkeypatch.setattr(worker, "HEARTBEAT", timedelta(seconds=0.1))
    release = asyncio.Event()
    runs = []

    async def long(ctx, payload):
        runs.append(payload)
        await release.wait()

    monkeypatch.setitem(HANDLERS, "probe", long)
    await add_job(sessionmaker)
    first = asyncio.create_task(run_one(job_ctx))
    await asyncio.sleep(1.2)  # well past STALE_AFTER: only the heartbeat keeps it
    assert not await run_one(job_ctx)
    release.set()
    assert await first
    assert runs == [{"n": 1}]
    assert (await the_job(sessionmaker)).status == JobStatus.done


async def test_a_stopping_worker_puts_its_job_back(job_ctx, sessionmaker, monkeypatch):
    monkeypatch.setattr(worker, "SHUTDOWN_GRACE_SECONDS", 0.1)
    started = asyncio.Event()

    async def endless(ctx, payload):
        started.set()
        await asyncio.Event().wait()

    monkeypatch.setitem(HANDLERS, "probe", endless)
    await add_job(sessionmaker)
    stop = asyncio.Event()
    running = asyncio.create_task(run_one(job_ctx, stop))
    await started.wait()
    stop.set()
    assert await asyncio.wait_for(running, 5)
    job = await the_job(sessionmaker)
    # At once and for another try: the attempt cut short doesn't count.
    assert (job.status, job.attempts, job.locked_at) == (JobStatus.queued, 0, None)
    assert job.run_after <= utcnow()


async def test_a_job_that_asks_to_wait_runs_later_without_losing_a_try(
    job_ctx, sessionmaker, monkeypatch
):
    later = utcnow() + timedelta(minutes=10)

    async def not_now(ctx, payload):
        raise Postpone(later, "the web service is down")

    monkeypatch.setitem(HANDLERS, "probe", not_now)
    await add_job(sessionmaker)
    assert await run_one(job_ctx)
    job = await the_job(sessionmaker)
    assert (job.status, job.attempts, job.error) == (
        JobStatus.queued,
        0,
        "the web service is down",
    )
    assert abs((job.run_after - later).total_seconds()) < 1
    assert not await run_one(job_ctx)  # not due yet


async def test_a_worker_taken_for_dead_doesnt_overwrite_the_next_ones_work(sessionmaker):
    await add_job(sessionmaker)
    async with sessionmaker() as session:
        first = await claim(session)
    async with sessionmaker() as session:
        await session.execute(
            update(Job).values(locked_at=utcnow() - STALE_AFTER - timedelta(seconds=1))
        )
        await session.commit()
    async with sessionmaker() as session:
        second = await claim(session)
    assert first is not None and second is not None and second.attempts == 2
    async with sessionmaker() as session:
        await mark_failed(session, first, "the first worker, late")
        await touch(session, first)
    job = await the_job(sessionmaker)
    assert (job.status, job.error) == (JobStatus.running, None)
    async with sessionmaker() as session:
        await mark_done(session, second)
    assert (await the_job(sessionmaker)).status == JobStatus.done
