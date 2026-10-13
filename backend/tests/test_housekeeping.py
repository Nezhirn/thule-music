import os
import time
from datetime import timedelta

from sqlalchemy import select

from app.auth.models import RefreshToken
from app.db import utcnow
from app.jobs.housekeeping import housekeeping, schedule_housekeeping
from app.jobs.models import Job, JobStatus
from app.library.models import Cover, TrackFile
from tests.conftest import png_bytes


def age(path, hours: float) -> None:
    then = time.time() - hours * 3600
    os.utime(path, (then, then))


async def test_old_jobs_and_expired_tokens_are_removed(job_ctx, sessionmaker, user):
    now = utcnow()
    async with sessionmaker() as session:
        for status, days in [
            (JobStatus.done, 8),
            (JobStatus.done, 1),
            (JobStatus.failed, 31),
            (JobStatus.failed, 10),
        ]:
            session.add(
                Job(kind=f"{status}-{days}", status=status, finished_at=now - timedelta(days=days))
            )
        session.add(
            Job(kind="queued", status=JobStatus.queued, created_at=now - timedelta(days=90))
        )
        # The last scan stays, to show what it found; the one before goes.
        for days in (20, 9):
            session.add(
                Job(
                    kind="scan_library",
                    status=JobStatus.done,
                    finished_at=now - timedelta(days=days),
                    result={"days": days},
                )
            )
        token = (await session.scalars(select(RefreshToken))).first()
        session.add(
            RefreshToken(
                user_id=token.user_id, token_hash="x" * 64, expires_at=now - timedelta(hours=1)
            )
        )
        await session.commit()

    await housekeeping(job_ctx, {})

    async with sessionmaker() as session:
        kinds = set(await session.scalars(select(Job.kind)))
        scans = list(await session.scalars(select(Job.result).where(Job.kind == "scan_library")))
        hashes = set(await session.scalars(select(RefreshToken.token_hash)))
    assert kinds == {"done-1", "failed-10", "queued", "scan_library"}
    assert scans == [{"days": 9}]
    assert "x" * 64 not in hashes and hashes  # the live sessions stay


async def test_files_and_covers_of_deleted_tracks_are_removed(
    client, admin, make_audio, run_jobs, job_ctx, sessionmaker, settings
):
    keep = make_audio("keep/1.mp3", title="K", artist="A", album="Keep", cover=(1, 2, 3))
    gone = make_audio("gone/1.mp3", title="G", artist="B", album="Gone", cover=(200, 0, 0))
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    async with sessionmaker() as session:
        before_files = set(await session.scalars(select(TrackFile.path)))
        assert len(set(await session.scalars(select(Cover.id)))) == 2
    all_files = [p for p in settings.transcodes_path.rglob("*") if p.is_file()]
    all_files += [p for p in settings.covers_path.rglob("*") if p.is_file()]
    for path in all_files:
        age(path, 2)

    gone.unlink()
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    stray = settings.transcodes_path / "zz" / "fresh.opus"  # e.g. a transcode just finishing
    stray.parent.mkdir(parents=True)
    stray.write_bytes(b"x")
    await housekeeping(job_ctx, {})

    async with sessionmaker() as session:
        live_files = set(await session.scalars(select(TrackFile.path)))
        (cover,) = (await session.scalars(select(Cover))).all()
    assert len(live_files) == 2 and live_files < before_files
    on_disk = {
        p.relative_to(settings.transcodes_path).as_posix()
        for p in settings.transcodes_path.rglob("*")
        if p.is_file()
    }
    assert on_disk == live_files | {"zz/fresh.opus"}
    cover_files = {p.name for p in settings.covers_path.rglob("*") if p.is_file()}
    assert cover_files and all(name.startswith(cover.source_hash) for name in cover_files)
    assert keep.exists()
    album = (await client.get("/albums", headers=admin)).json()["items"][0]
    assert (await client.get(f"/covers/{album['cover_id']}?size=64")).status_code == 200


async def test_avatars_are_not_unused_covers(client, user, job_ctx):
    resp = await client.put(
        "/auth/me/avatar", files={"file": ("me.png", png_bytes((5, 5, 5)))}, headers=user
    )
    await housekeeping(job_ctx, {})
    avatar = resp.json()["avatar_id"]
    assert (await client.get(f"/covers/{avatar}?size=64")).status_code == 200


async def test_housekeeping_is_scheduled_once_per_interval(job_ctx, sessionmaker):
    assert await schedule_housekeeping(job_ctx) is True
    assert await schedule_housekeeping(job_ctx) is False  # already queued
    async with sessionmaker() as session:
        job = (await session.scalars(select(Job).where(Job.kind == "housekeeping"))).one()
        job.status = JobStatus.done
        job.created_at = utcnow() - timedelta(
            seconds=job_ctx.settings.housekeeping_interval_seconds + 60
        )
        await session.commit()
    assert await schedule_housekeeping(job_ctx) is True
