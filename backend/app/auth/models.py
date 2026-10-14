import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Enum, ForeignKey, Index, String, false, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UUIDPk, utcnow


class Role(enum.StrEnum):
    admin = "admin"
    user = "user"


class User(UUIDPk, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(128))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, name="user_role"), default=Role.user)
    # A picture from the covers table (same storage and thumbnails); None until uploaded.
    avatar_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("covers.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    # When the user last signed in or a client of theirs renewed its tokens (every few
    # minutes while in use). None until the first sign-in.
    last_seen_at: Mapped[datetime | None]
    # Settings shared by all the user's clients (app.me.preferences). Only values the user
    # changed are stored, so defaults can still change later.
    preferences: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )

    __table_args__ = (
        Index("ix_users_avatar_id", "avatar_id", postgresql_where=text("avatar_id IS NOT NULL")),
    )


class RefreshToken(UUIDPk, Base):
    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    # Revoked because it was exchanged for a new token. Only such a token showing up again
    # means it was copied; one revoked by logout or a password change is merely stale.
    rotated: Mapped[bool] = mapped_column(default=False, server_default=false())
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class LoginFailure(UUIDPk, Base):
    """A failed login, for throttling password guessing (see auth.router.login)."""

    __tablename__ = "login_failures"

    # As typed: attempts on names that don't exist are throttled too.
    username: Mapped[str] = mapped_column(String(64))
    failed_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (Index("ix_login_failures_username_failed_at", "username", "failed_at"),)
