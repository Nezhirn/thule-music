"""Test fixtures. Tests run against the real Postgres from `.env`, inside a dedicated schema
(THULE_TEST_SCHEMA, default `thule_test`) that is rebuilt via Alembic once per session."""

import io
import os
import subprocess
import sys
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.db import make_engine, make_sessionmaker
from app.jobs.context import JobContext
from app.jobs.worker import drain
from app.main import create_app
from app.models import Base

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_SCHEMA = os.environ.get("THULE_TEST_SCHEMA", "thule_test")
if TEST_SCHEMA == "public":
    raise RuntimeError("Refusing to run tests in the public schema")


@pytest.fixture(scope="session")
def migrated_schema() -> str:
    """Drops the test schema and rebuilds it with the real migrations."""
    base = Settings()
    engine = make_engine(base.database_url, TEST_SCHEMA, poolclass=NullPool)

    import asyncio

    async def reset() -> None:
        async with engine.begin() as conn:
            await conn.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{TEST_SCHEMA}" CASCADE')
        await engine.dispose()

    asyncio.run(reset())
    subprocess.run(
        [sys.executable, "-m", "alembic", "-x", f"schema={TEST_SCHEMA}", "upgrade", "head"],
        cwd=BACKEND_DIR,
        check=True,
        capture_output=True,
    )
    return TEST_SCHEMA


@pytest.fixture
def settings(migrated_schema: str, tmp_path: Path) -> Settings:
    library = tmp_path / "library"
    library.mkdir()
    return Settings(
        db_schema=migrated_schema,
        library_path=library,
        data_path=tmp_path / "data",
        secret_key="test-secret-key-0123456789abcdef0123",
        lrclib_enabled=False,
    )


@pytest.fixture(scope="session")
async def engine(migrated_schema: str) -> AsyncIterator[AsyncEngine]:
    # One pooled engine for the whole run: connecting to a remote Postgres is slow.
    engine = make_engine(Settings().database_url, migrated_schema, pool_size=5)
    yield engine
    await engine.dispose()


@pytest.fixture
async def sessionmaker(engine: AsyncEngine):
    async with engine.begin() as conn:
        tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
        await conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    return make_sessionmaker(engine)


@pytest.fixture
def lrclib_responses() -> dict[str, httpx.Response]:
    """Map of track_name -> canned LRCLIB response; unknown tracks get 404."""
    return {}


@pytest.fixture
async def job_ctx(settings, sessionmaker, lrclib_responses) -> AsyncIterator[JobContext]:
    def handler(request: httpx.Request) -> httpx.Response:
        name = request.url.params.get("track_name", "")
        return lrclib_responses.get(name, httpx.Response(404, json={"code": 404}))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        yield JobContext(settings, sessionmaker, http)


@pytest.fixture
def run_jobs(job_ctx: JobContext) -> Callable:
    async def _run() -> int:
        return await drain(job_ctx)

    return _run


@pytest.fixture
async def client(settings, sessionmaker) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings)
    app.state.sessionmaker = sessionmaker  # ASGITransport does not run the lifespan
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test/api/v1") as c:
        yield c


async def register_and_login(
    client: httpx.AsyncClient, username: str, password: str, headers: dict | None = None
) -> dict[str, str]:
    resp = await client.post(
        "/auth/register", json={"username": username, "password": password}, headers=headers or {}
    )
    assert resp.status_code == 201, resp.text
    resp = await client.post("/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.fixture
async def admin(client) -> dict[str, str]:
    return await register_and_login(client, "admin", "admin-password")


@pytest.fixture
async def user(client, admin) -> dict[str, str]:
    return await register_and_login(client, "listener", "listener-password", headers=admin)


def png_bytes(color: tuple[int, int, int], size: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def make_audio(settings: Settings) -> Callable[..., Path]:
    """Creates a short tagged sine-wave file inside the library."""

    def _make(
        rel: str,
        *,
        title: str,
        artist: str,
        album: str,
        album_artist: str | None = None,
        track: int | None = None,
        year: int | None = None,
        duration: float = 2.0,
        cover: tuple[int, int, int] | None = None,
        lyrics: str | None = None,
    ) -> Path:
        path = settings.library_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        meta = {"title": title, "artist": artist, "album": album}
        if album_artist:
            meta["album_artist"] = album_artist
        if track:
            meta["track"] = str(track)
        if year:
            meta["date"] = str(year)
        if lyrics:
            meta["lyrics"] = lyrics
        cmd = [
            "ffmpeg",
            "-nostdin",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"sine=frequency=440:duration={duration}",
        ]
        if cover is not None and path.suffix == ".mp3":
            cover_path = path.with_suffix(".cover.png")
            cover_path.write_bytes(png_bytes(cover))
            cmd += [
                "-i",
                str(cover_path),
                "-map",
                "0:a",
                "-map",
                "1:v",
                "-c:v",
                "png",
                "-id3v2_version",
                "3",
                "-metadata:s:v",
                "comment=Cover (front)",
            ]
        for key, value in meta.items():
            cmd += ["-metadata", f"{key}={value}"]
        cmd.append(str(path))
        subprocess.run(cmd, check=True)
        if cover is not None and path.suffix == ".mp3":
            path.with_suffix(".cover.png").unlink()
        elif cover is not None:
            (path.parent / "cover.png").write_bytes(png_bytes(cover))
        return path

    return _make
