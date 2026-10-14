"""The API under database trouble and slow listeners: nothing hangs, errors keep their shape."""

import asyncio
import io

import httpx
import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.db import make_engine, make_sessionmaker
from app.main import create_app
from tests.conftest import png_bytes


async def one_track(client, admin, make_audio, run_jobs) -> dict:
    make_audio("a/1.flac", title="T", artist="A", album="X", duration=3)
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    return (await client.get("/tracks", headers=admin)).json()["items"][0]


async def test_a_slow_listener_holds_no_database_connection(
    client, admin, make_audio, run_jobs, settings, sessionmaker, engine
):
    """A file streams for as long as the listener takes: the pool must not wait with it."""
    track = await one_track(client, admin, make_audio, run_jobs)
    app = create_app(settings)
    app.state.sessionmaker = sessionmaker
    body_started, listener_reads = asyncio.Event(), asyncio.Event()

    async def receive():
        await listener_reads.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body" and not body_started.is_set():
            body_started.set()
            await listener_reads.wait()  # a listener that doesn't read

    path = f"/api/v1/tracks/{track['id']}/stream"
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"quality=original",
        "headers": [(b"host", b"test"), (b"authorization", admin["Authorization"].encode())],
        "server": ("test", 80),
        "client": ("test", 1),
    }
    streaming = asyncio.create_task(app(scope, receive, send))
    await asyncio.wait_for(body_started.wait(), 5)
    assert engine.pool.checkedout() == 0
    listener_reads.set()
    await streaming


async def test_a_busy_pool_answers_503_rather_than_hang(settings):
    engine = make_engine(
        Settings().database_url, settings.db_schema, pool_size=1, max_overflow=0, pool_timeout=0.2
    )
    app = create_app(settings)
    app.state.sessionmaker = make_sessionmaker(engine)
    transport = httpx.ASGITransport(app=app)
    try:
        async with engine.connect() as held:
            await held.execute(text("SELECT 1"))
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
                resp = await c.get("/api/v1/health")
        assert resp.status_code == 503
        assert resp.json()["code"] == "service_unavailable"
        assert resp.headers["retry-after"] == "5"
    finally:
        await engine.dispose()


async def test_a_statement_past_its_timeout_is_cancelled(settings):
    engine = make_engine(
        Settings().database_url, settings.db_schema, statement_timeout=0.3, poolclass=NullPool
    )
    try:
        async with engine.connect() as connection:
            with pytest.raises(DBAPIError) as raised:
                await connection.execute(text("SELECT pg_sleep(3)"))
        assert raised.value.orig.sqlstate == "57014"  # type: ignore[union-attr]
    finally:
        await engine.dispose()


async def test_an_unexpected_error_still_has_the_apis_shape(settings, sessionmaker, monkeypatch):
    app = create_app(settings)
    app.state.sessionmaker = sessionmaker

    async def broken(*args, **kwargs):
        raise RuntimeError("a bug")

    monkeypatch.setattr("app.library.router.list_genres_out", broken, raising=False)
    monkeypatch.setattr("sqlalchemy.ext.asyncio.AsyncSession.execute", broken)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        resp = await c.get("/api/v1/health")
    assert resp.status_code == 500
    assert resp.json() == {"code": "internal_error", "detail": "Something went wrong on the server"}


async def test_plays_from_clients_without_time_zones_or_with_odd_values(
    client, admin, make_audio, run_jobs
):
    track = await one_track(client, admin, make_audio, run_jobs)
    play = {"track_id": track["id"], "played_at": "2026-10-01T10:00:00", "listened_ms": 31000}
    assert (await client.post("/me/plays", json=play, headers=admin)).status_code == 204
    (recent,) = (await client.get("/me/recent", headers=admin)).json()
    assert recent["played_at"].startswith("2026-10-01T10:00:00")
    too_long = {"track_id": track["id"], "listened_ms": 2**31}
    assert (await client.post("/me/plays", json=too_long, headers=admin)).status_code == 422
    odd = await client.get(f"/tracks/{track['id']}/stream?exp=9999999999&sig=%C3%A9")
    assert odd.json()["code"] == "invalid_stream_signature"


def image_bytes(size: tuple[int, int], fmt: str) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 60, 90)).save(buf, fmt)
    return buf.getvalue()


async def test_images_too_large_to_decode_are_refused_and_big_ones_kept_smaller(
    client, user, settings
):
    huge = image_bytes((8000, 6000), "PNG")  # 48 million pixels
    resp = await client.put("/auth/me/avatar", files={"file": ("huge.png", huge)}, headers=user)
    assert resp.json()["code"] == "not_an_image"

    scan = image_bytes((6000, 4000), "JPEG")
    resp = await client.put("/auth/me/avatar", files={"file": ("scan.jpg", scan)}, headers=user)
    assert resp.status_code == 200, resp.text
    full = await client.get(f"/covers/{resp.json()['avatar_id']}")
    with Image.open(io.BytesIO(full.content)) as kept:
        assert max(kept.size) <= 2000
    small = png_bytes((1, 2, 3))
    resp = await client.put("/auth/me/avatar", files={"file": ("s.png", small)}, headers=user)
    assert resp.status_code == 200
