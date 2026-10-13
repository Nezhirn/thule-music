import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UUIDPk, utcnow


class Playlist(UUIDPk, Base):
    __tablename__ = "playlists"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(256))
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class PlaylistItem(UUIDPk, Base):
    """One entry in a playlist. A track may appear several times, so items have their own id."""

    __tablename__ = "playlist_items"

    playlist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("playlists.id", ondelete="CASCADE"), index=True
    )
    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"))
    position: Mapped[int]
    added_at: Mapped[datetime] = mapped_column(default=utcnow)
