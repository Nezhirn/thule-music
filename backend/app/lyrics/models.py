import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, utcnow

# Lyrics files beside an audio file, with its name: "01 Song.lrc" for "01 Song.flac". The
# first one found is read.
SIDECAR_SUFFIXES = (".lrc", ".txt")

# The source of lyrics an admin wrote: they stay until the admin gives them up, whatever the
# files or LRCLIB say.
MANUAL = "manual"


class Lyrics(Base):
    __tablename__ = "lyrics"

    track_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True
    )
    plain: Mapped[str | None] = mapped_column(Text)
    # Raw LRC text with timestamps; parsed on read.
    synced: Mapped[str | None] = mapped_column(Text)
    instrumental: Mapped[bool] = mapped_column(default=False)
    # "sidecar" | "embedded" | "lrclib" | "manual" | "none" — "none" caches a negative
    # lookup. Manual lyrics with no text: the admin said the track has none.
    source: Mapped[str] = mapped_column(String(32))
    fetched_at: Mapped[datetime] = mapped_column(default=utcnow)
