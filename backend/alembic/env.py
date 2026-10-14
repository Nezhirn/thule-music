import asyncio
from logging.config import fileConfig

from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.pool import NullPool

from alembic import context
from app.config import get_settings
from app.db import make_engine
from app.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# Held while migrating: the API and the worker both migrate when they start, and on the first
# start of all even CREATE SCHEMA IF NOT EXISTS fails when two run it at once. The second
# process waits, then finds the schema up to date.
MIGRATIONS_LOCK = 0x7468_6D67  # "thmg"


def _schema() -> str:
    # `-x schema=...` overrides the configured schema (used by tests).
    return context.get_x_argument(as_dictionary=True).get("schema") or get_settings().db_schema


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    return not (type_ == "table" and name == "alembic_version")


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=_schema(),
        compare_type=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    settings = get_settings()
    schema = _schema()
    # No pool: closing the connection releases the lock, whatever happens.
    engine = make_engine(settings.database_url, schema, poolclass=NullPool)
    async with engine.connect() as locked:
        # Tried again and again rather than waited for: a process waiting inside a statement
        # would be a transaction that an index built CONCURRENTLY by the other one waits to
        # see end, while it waits for that one's lock: a deadlock.
        locked = await locked.execution_options(isolation_level="AUTOCOMMIT")
        try_lock = text(f"SELECT pg_try_advisory_lock({MIGRATIONS_LOCK})")
        while not await locked.scalar(try_lock):  # noqa: ASYNC110 - polling the database
            await asyncio.sleep(0.5)
        async with engine.connect() as connection:
            # A change that waits for a table's lock behind a long transaction would make
            # every query of that table queue behind it: it gives up instead (the start
            # fails, and the container's restart tries again).
            await connection.exec_driver_sql("SET lock_timeout = '10s'")
            await connection.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            await connection.commit()
            await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline migrations are not supported")
asyncio.run(run_async_migrations())
