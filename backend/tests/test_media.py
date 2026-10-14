import asyncio
import os
import time

import pytest
from sqlalchemy import delete, select

from app.library.models import TrackFile
from app.media import transcode
from app.media.transcode import run_ffmpeg


async def one_track(client, admin, make_audio, run_jobs) -> dict:
    make_audio("a/1.mp3", title="T", artist="A", album="X", duration=3)
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    return (await client.get("/tracks", headers=admin)).json()["items"][0]


def path_and_query(url: str) -> str:
    assert url.startswith("/api/v1/tracks/"), url  # relative to the server, no host
    return url.removeprefix("/api/v1")


async def test_stream_original_supports_range(client, admin, make_audio, run_jobs, settings):
    track = await one_track(client, admin, make_audio, run_jobs)
    full = await client.get(f"/tracks/{track['id']}/stream?quality=original", headers=admin)
    assert full.status_code == 200
    assert full.headers["content-type"] == "audio/mpeg"
    assert full.headers["accept-ranges"] == "bytes"
    size = (settings.library_path / "a/1.mp3").stat().st_size
    assert len(full.content) == size

    part = await client.get(
        f"/tracks/{track['id']}/stream?quality=original",
        headers={**admin, "Range": "bytes=0-1023"},
    )
    assert part.status_code == 206
    assert part.headers["content-range"] == f"bytes 0-1023/{size}"
    assert part.content == full.content[:1024]


async def test_transcoded_variants_are_served(client, admin, make_audio, run_jobs):
    track = await one_track(client, admin, make_audio, run_jobs)
    for quality in ("high", "low"):
        resp = await client.get(f"/tracks/{track['id']}/stream?quality={quality}", headers=admin)
        assert resp.status_code == 200
        assert resp.headers["x-thule-quality"] == quality
        assert resp.headers["content-type"].startswith("audio/ogg")
        assert resp.content[:4] == b"OggS"


async def test_signed_url_plays_without_auth(client, admin, make_audio, run_jobs):
    track = await one_track(client, admin, make_audio, run_jobs)
    assert (await client.get(f"/tracks/{track['id']}/stream")).status_code == 401

    signed = (await client.get(f"/tracks/{track['id']}/stream-url", headers=admin)).json()
    assert signed["quality"] == "high"
    assert (signed["codec"], signed["bitrate"]) == ("opus", 160)
    resp = await client.get(path_and_query(signed["url"]))
    assert resp.status_code == 200
    assert resp.headers["x-thule-quality"] == "high"

    # Tampering with quality or signature is rejected.
    tampered = path_and_query(signed["url"]).replace("quality=high", "quality=original")
    assert (await client.get(tampered)).status_code == 401
    bad_sig = path_and_query(signed["url"]).replace("sig=", "sig=x")
    assert (await client.get(bad_sig)).status_code == 401


async def test_signed_url_is_pinned_to_original_until_transcoded(
    client, admin, make_audio, run_jobs, sessionmaker
):
    track = await one_track(client, admin, make_audio, run_jobs)
    async with sessionmaker() as session:
        await session.execute(delete(TrackFile))
        await session.commit()
    signed = (await client.get(f"/tracks/{track['id']}/stream-url", headers=admin)).json()
    assert signed["quality"] == "original"
    assert (signed["codec"], signed["bitrate"]) == ("mp3", track["bitrate"])
    resp = await client.get(path_and_query(signed["url"]))
    assert resp.headers["x-thule-quality"] == "original"


async def test_cover_sizes(client, admin, make_audio, run_jobs):
    make_audio("a/1.mp3", title="T", artist="A", album="X", cover=(1, 2, 3))
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    album = (await client.get("/albums", headers=admin)).json()["items"][0]
    for size in ("", "?size=64", "?size=300", "?size=600"):
        resp = await client.get(f"/covers/{album['cover_id']}{size}")
        assert resp.status_code == 200
        assert "immutable" in resp.headers["cache-control"]
    assert (await client.get(f"/covers/{album['cover_id']}?size=65")).status_code == 422


async def test_hung_ffmpeg_is_killed(tmp_path, monkeypatch):
    fake = tmp_path / "bin" / "ffmpeg"
    fake.parent.mkdir()
    pid_file = tmp_path / "pid"
    fake.write_text(f"#!/bin/sh\necho $$ > {pid_file}\nexec sleep 30\n")
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fake.parent}:{os.environ['PATH']}")
    dst = tmp_path / "out" / "x.opus"

    started = time.monotonic()
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.5):
            await run_ffmpeg(tmp_path / "in.mp3", dst, 96)
    assert time.monotonic() - started < 5
    assert not dst.exists() and not dst.with_suffix(".part").exists()
    with pytest.raises(ProcessLookupError):  # killed and reaped, not left running
        os.kill(int(pid_file.read_text()), 0)


async def test_a_file_changed_while_transcoded_is_transcoded_again(
    client, admin, make_audio, run_jobs, settings, job_ctx, monkeypatch
):
    track = await one_track(client, admin, make_audio, run_jobs)
    async with job_ctx.sessionmaker() as session:
        await session.execute(delete(TrackFile))
        await session.commit()

    def changed_meanwhile(src, dst, bitrate):
        os.utime(src, (time.time(), time.time() + 5))
        return run_ffmpeg(src, dst, bitrate)

    monkeypatch.setattr(transcode, "run_ffmpeg", changed_meanwhile)
    with pytest.raises(transcode.SourceChanged):
        await transcode.transcode_track(job_ctx, {"track_id": track["id"]})
    async with job_ctx.sessionmaker() as session:
        assert (await session.scalars(select(TrackFile))).all() == []

    monkeypatch.undo()
    await transcode.transcode_track(job_ctx, {"track_id": track["id"]})
    async with job_ctx.sessionmaker() as session:
        assert len((await session.scalars(select(TrackFile))).all()) == 2
