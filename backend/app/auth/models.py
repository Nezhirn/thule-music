import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Enum, ForeignKey, String, false, text
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
    # Settings shared by all the user's clients (app.me.preferences). Only values the user
    # changed are stored, so defaults can still change later.
    preferences: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
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
