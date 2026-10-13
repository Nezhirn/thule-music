"""Drops a scratch Postgres schema and rebuilds it with the migrations (used by the web E2E
stand; pytest does the same for `thule_test`). Refuses `public` and the schema the app is
configured to use, so it can't wipe real data.

Usage: .venv/bin/python scripts/reset_schema.py thule_e2e
"""

import asyncio
import subprocess
import sys
from pathlib import Path

from sqlalchemy.pool import NullPool

from app.config import Settings
from app.db import make_engine

BACKEND_DIR = Path(__file__).resolve().parents[1]


async def drop(settings: Settings, schema: str) -> None:
    engine = make_engine(settings.database_url, schema, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
    await engine.dispose()


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1].isidentifier():
        sys.exit("usage: reset_schema.py SCHEMA")
    schema = sys.argv[1]
    settings = Settings()
    if schema in {"public", settings.db_schema}:
        sys.exit(f"refusing to reset {schema!r}: it holds the app's data")
    asyncio.run(drop(settings, schema))
    subprocess.run(
        [sys.executable, "-m", "alembic", "-x", f"schema={schema}", "upgrade", "head"],
        cwd=BACKEND_DIR,
        check=True,
    )


if __name__ == "__main__":
    main()
