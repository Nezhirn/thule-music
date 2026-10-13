from datetime import timedelta

from sqlalchemy import event, select

from app.db import utcnow
from app.jobs.models import Job, JobStatus
from app.jobs.queue import STALE_AFTER, enqueue, enqueue_many
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
