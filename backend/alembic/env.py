import asyncio
from logging.config import fileConfig

from sqlalchemy.engine import Connection

from alembic import context
from app.config import get_settings
from app.db import make_engine
from app.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


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
    engine = make_engine(settings.database_url, schema)
    async with engine.connect() as connection:
        await connection.exec_driver_sql(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        await connection.commit()
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline migrations are not supported")
asyncio.run(run_async_migrations())
