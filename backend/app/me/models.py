import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UUIDPk, utcnow


class TrackLike(Base):
    __tablename__ = "track_likes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    track_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class PlayEvent(UUIDPk, Base):
    __tablename__ = "play_events"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"))
    played_at: Mapped[datetime] = mapped_column(default=utcnow)
    # How much was actually listened to; lets "For You" ignore skips.
    listened_ms: Mapped[int | None]

    __table_args__ = (Index("ix_play_events_user_played", "user_id", "played_at"),)
