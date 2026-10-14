"""Getting the server ready in production: settings, the database, migrations, folders."""

import asyncio
import io
import logging
import subprocess
import sys
import time

import pytest
from sqlalchemy import make_url, text
from sqlalchemy.pool import NullPool

from app.cli import (
    check_folders,
    load_settings,
    migrate,
    read_password,
    reset_password,
    unlock_user,
    wait_for_database,
)
from app.config import Settings, get_settings
from app.db import make_engine
from tests.conftest import BACKEND_DIR, TEST_SCHEMA

SCHEMA = f"{TEST_SCHEMA}_migrations"


async def drop_schema() -> None:
    engine = make_engine(Settings().database_url, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE')
    await engine.dispose()


async def test_the_api_and_the_worker_migrate_a_new_database_at_once(migrated_schema):
    await drop_schema()
    try:
        migrate = [sys.executable, "-m", "alembic", "-x", f"schema={SCHEMA}", "upgrade", "head"]
        runs = [
            await asyncio.create_subprocess_exec(
                *migrate, cwd=BACKEND_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
            )
            for _ in range(2)
        ]
        outputs = await asyncio.gather(*(run.communicate() for run in runs))
        for run, (output, _) in zip(runs, outputs, strict=True):
            assert run.returncode == 0, output.decode()
        # One of them did the work; the other found it done.
        ran = [output.decode().count("Running upgrade") for output, _ in outputs]
        assert sorted(ran)[0] == 0
        assert sorted(ran)[1] > 0

        engine = make_engine(Settings().database_url, SCHEMA, poolclass=NullPool)
        async with engine.connect() as connection:
            versions = await connection.execute(text(f'SELECT * FROM "{SCHEMA}".alembic_version'))
            assert len(versions.all()) == 1
        await engine.dispose()
    finally:
        await drop_schema()


def test_an_unreachable_database_is_named_without_its_password(settings):
    unreachable = settings.model_copy(
        update={"database_url": "postgresql+asyncpg://thule:s3cret@127.0.0.1:9/thule"}
    )
    with pytest.raises(SystemExit) as exit:
        wait_for_database(unreachable, timeout=0)
    message = str(exit.value)
    assert message.startswith("The database at postgresql+asyncpg://thule:***@127.0.0.1:9/thule")
    assert "s3cret" not in message


def test_a_wrong_password_ends_the_wait_at_once(settings):
    url = make_url(settings.database_url).set(password="certainly-wrong")
    wrong = settings.model_copy(update={"database_url": url.render_as_string(False)})
    started = time.monotonic()
    with pytest.raises(SystemExit, match="refused: .*password authentication failed"):
        wait_for_database(wrong, timeout=30)
    assert time.monotonic() - started < 10


def test_missing_settings_are_named(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)  # no .env here
    monkeypatch.delenv("THULE_SECRET_KEY", raising=False)
    get_settings.cache_clear()
    try:
        with pytest.raises(SystemExit, match="THULE_SECRET_KEY: Field required"):
            load_settings()
    finally:
        get_settings.cache_clear()


def test_folders_the_server_cant_use(settings, tmp_path, monkeypatch, caplog):
    check_folders(settings)
    assert settings.data_path.is_dir()

    blocked = tmp_path / "not-a-folder"
    blocked.write_text("")
    with pytest.raises(SystemExit, match=r"Can't write to the data folder .*chown -R \d+:\d+"):
        check_folders(settings.model_copy(update={"data_path": blocked / "data"}))

    with pytest.raises(SystemExit, match="music library folder .* doesn't exist"):
        check_folders(settings.model_copy(update={"library_path": tmp_path / "no-music"}))

    # A library the server can only read: it starts, and says what won't work.
    monkeypatch.setattr("app.cli.os.access", lambda path, mode: False)
    with caplog.at_level(logging.WARNING, logger="thule"):
        check_folders(settings)
    assert "uploads won't work" in caplog.text


async def test_a_database_newer_than_the_code_is_named(migrated_schema, monkeypatch):
    await drop_schema()
    engine = make_engine(Settings().database_url, poolclass=NullPool)
    async with engine.begin() as connection:
        await connection.exec_driver_sql(f'CREATE SCHEMA "{SCHEMA}"')
        await connection.exec_driver_sql(
            f'CREATE TABLE "{SCHEMA}".alembic_version (version_num varchar(32) PRIMARY KEY)'
        )
        await connection.exec_driver_sql(
            f"INSERT INTO \"{SCHEMA}\".alembic_version VALUES ('ffffffffffff')"
        )
    await engine.dispose()
    monkeypatch.setenv("THULE_DB_SCHEMA", SCHEMA)
    try:
        with pytest.raises(SystemExit, match="newer version of Thule"):
            migrate()
    finally:
        await drop_schema()


def test_an_empty_music_folder_is_warned_about(settings, caplog):
    with caplog.at_level(logging.WARNING, logger="thule"):
        check_folders(settings)
    assert "is empty: if the music is on a disk, is it mounted?" in caplog.text


async def test_a_forgotten_or_locked_out_admin_gets_back_in(client, admin, settings, sessionmaker):
    for _ in range(10):
        await client.post("/auth/login", json={"username": "admin", "password": "wrong-one"})
    locked = await client.post("/auth/login", json={"username": "admin", "password": "x"})
    assert locked.json()["code"] == "too_many_login_attempts"

    await unlock_user(settings, "admin")
    back = {"username": "admin", "password": "admin-password"}
    assert (await client.post("/auth/login", json=back)).status_code == 200

    await reset_password(settings, "admin", "brand-new-password")
    assert (await client.get("/auth/me", headers=admin)).status_code == 200  # access lives on
    old = (await client.post("/auth/login", json=back)).json()
    assert old["code"] == "invalid_credentials"
    new = {"username": "admin", "password": "brand-new-password"}
    assert (await client.post("/auth/login", json=new)).status_code == 200
    with pytest.raises(SystemExit, match="No user 'nobody'"):
        await unlock_user(settings, "nobody")


def test_a_new_password_comes_from_standard_input(monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO("long-enough-password\n"))
    assert read_password() == "long-enough-password"
    monkeypatch.setattr("sys.stdin", io.StringIO("short\n"))
    with pytest.raises(SystemExit, match="at least 8"):
        read_password()
