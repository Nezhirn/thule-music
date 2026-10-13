"""Runs the server in production (what the Docker image runs):

    thule serve     the API and the web app
    thule worker    background jobs
    thule migrate   bring the database schema up to date and exit

`serve` and `worker` get ready first, so either may start first and the database may still be
starting up: they wait for the database, bring its schema up to date (one process at a time,
see alembic/env.py) and check that the folders they write to can be written to.
"""

import argparse
import asyncio
import logging
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import make_url, text
from sqlalchemy.pool import NullPool

from app.config import Settings, get_settings
from app.db import make_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATABASE_WAIT_SECONDS = 60

log = logging.getLogger("thule")


def load_settings() -> Settings:
    try:
        return get_settings()
    except ValidationError as exc:
        problems = "; ".join(
            f"THULE_{'_'.join(map(str, error['loc'])).upper()}: {error['msg']}"
            for error in exc.errors()
        )
        raise SystemExit(f"Settings: {problems}") from None


def wait_for_database(settings: Settings, timeout: float = DATABASE_WAIT_SECONDS) -> None:
    where = make_url(settings.database_url).render_as_string(hide_password=True)

    async def ping() -> None:
        engine = make_engine(settings.database_url, settings.db_schema, poolclass=NullPool)
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
        finally:
            await engine.dispose()

    deadline = time.monotonic() + timeout
    while True:
        try:
            asyncio.run(ping())
            return
        except Exception as exc:  # refused, the name not resolving yet, "starting up", ...
            reason = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
            # A wrong password or database name won't fix itself by waiting.
            sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None) or ""
            if sqlstate.startswith("28") or sqlstate == "3D000":
                raise SystemExit(f"The database at {where} refused: {reason}") from None
            if time.monotonic() >= deadline:
                raise SystemExit(f"The database at {where} is unreachable: {reason}") from None
            log.info("Waiting for the database at %s: %s", where, reason)
            time.sleep(2)


def migrate() -> None:
    # A process of its own: Alembic's env.py runs its own event loop and logging setup.
    result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND_DIR)
    if result.returncode:
        raise SystemExit("Migrating the database failed (see above)")


def check_folders(settings: Settings) -> None:
    """The data folder must be writable (covers, transcodes); the library should be (uploads).
    In Docker these are host folders: the usual trouble is their owner."""
    owner = f"{os.getuid()}:{os.getgid()}"
    data = settings.data_path
    try:
        data.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=data):
            pass
    except OSError as exc:
        raise SystemExit(
            f"Can't write to the data folder {data}: {exc.strerror}. The server runs as "
            f"{owner}: make that the owner of the folder (chown -R {owner} <folder>)."
        ) from None
    library = settings.library_path
    if not library.is_dir():
        raise SystemExit(f"The music library folder {library} doesn't exist")
    uploads = settings.uploads_path if settings.uploads_path.is_dir() else library
    if not os.access(uploads, os.W_OK):
        log.warning(
            "Can't write to %s: uploads won't work (the server runs as %s). Scanning the "
            "library and listening work.",
            uploads,
            owner,
        )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="thule", description="Thule Music server")
    commands = parser.add_subparsers(dest="command", required=True)
    serve = commands.add_parser("serve", help="the API and the web app")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=8000)
    worker = commands.add_parser("worker", help="background jobs")
    worker.add_argument("--concurrency", type=int, default=2)
    commands.add_parser("migrate", help="bring the database schema up to date and exit")
    args = parser.parse_args(argv)
    # In a container this is process 1, which the kernel doesn't stop on SIGTERM unless it
    # asks to be: `docker stop` while waiting for the database would wait for the kill.
    # Uvicorn and the worker put their own handlers in place once running.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(128 + signal.SIGTERM))

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    settings = load_settings()
    wait_for_database(settings)
    migrate()
    if args.command == "migrate":
        return
    check_folders(settings)

    if args.command == "serve":
        import uvicorn

        # Client addresses from X-Forwarded-For are trusted from FORWARDED_ALLOW_IPS (the
        # reverse proxy's address; 127.0.0.1 by default).
        uvicorn.run("app.main:app", host=args.host, port=args.port, proxy_headers=True)
    else:
        from app.jobs.worker import main as run_worker

        asyncio.run(run_worker(settings, args.concurrency))


if __name__ == "__main__":
    main()
