import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, MetaData
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {datetime: DateTime(timezone=True)}


class UUIDPk:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)


# Connecting to a database that doesn't answer gives up after this long.
CONNECT_TIMEOUT_SECONDS = 10


def make_engine(
    url: str,
    schema: str = "public",
    *,
    statement_timeout: float | None = None,
    **kwargs: Any,
) -> AsyncEngine:
    """With `statement_timeout` (seconds), a statement running longer is cancelled by the
    server, a connection left idle inside a transaction longer is closed by it, and one
    that doesn't answer for longer (a network gone silent) is given up by the client:
    nothing waits for ever. Without it (migrations, the worker's long jobs) only connecting
    is limited."""
    search_path = schema if schema == "public" else f"{schema},public"
    server_settings = {"search_path": search_path}
    connect_args: dict[str, Any] = {
        "server_settings": server_settings,
        "timeout": CONNECT_TIMEOUT_SECONDS,
    }
    if statement_timeout is not None:
        ms = str(int(statement_timeout * 1000))
        server_settings |= {"statement_timeout": ms, "idle_in_transaction_session_timeout": ms}
        connect_args["command_timeout"] = statement_timeout + 5
    return create_async_engine(url, connect_args=connect_args, **kwargs)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
