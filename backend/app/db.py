import time
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, MetaData, event
from sqlalchemy.exc import DisconnectionError
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


# pg_trgm word_similarity threshold for typo-tolerant matches ("katatonya" -> "Katatonia").
FUZZY_THRESHOLD = 0.4

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
    server_settings = {
        "search_path": search_path,
        # Search's fuzzy matches (`q <% name`, see app.search.router).
        "pg_trgm.word_similarity_threshold": str(FUZZY_THRESHOLD),
    }
    connect_args: dict[str, Any] = {
        "server_settings": server_settings,
        "timeout": CONNECT_TIMEOUT_SECONDS,
    }
    if statement_timeout is not None:
        ms = str(int(statement_timeout * 1000))
        server_settings |= {"statement_timeout": ms, "idle_in_transaction_session_timeout": ms}
        connect_args["command_timeout"] = statement_timeout + 5
    return create_async_engine(url, connect_args=connect_args, **kwargs)


def ping_when_idle(engine: AsyncEngine, after: float = 10) -> None:
    """Before use, a pooled connection that sat idle longer than `after` seconds is checked
    (the database restarted, a firewall forgot it): a dead one is replaced. Unlike
    pool_pre_ping, one used a moment ago isn't: the check is a round trip to the database,
    and a page asks a few things at once."""
    sync = engine.sync_engine

    @event.listens_for(sync, "checkin")
    def checkin(dbapi_connection: Any, record: Any) -> None:
        record.info["idle_since"] = time.monotonic()

    @event.listens_for(sync, "checkout")
    def checkout(dbapi_connection: Any, record: Any, proxy: Any) -> None:
        since = record.info.get("idle_since")
        if since is not None and time.monotonic() - since > after:
            try:
                sync.dialect.do_ping(dbapi_connection)
            except Exception as exc:
                raise DisconnectionError("Idle connection is dead") from exc


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
