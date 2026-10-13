import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Enum, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UUIDPk, utcnow


def name_key(value: str) -> str:
    """Normalised key used to merge 'The Cure' / 'the cure ' into one entity."""
    return " ".join(value.casefold().split())


class Cover(UUIDPk, Base):
    __tablename__ = "covers"

    # sha256 of the source image bytes — identical artwork is stored once.
    source_hash: Mapped[str] = mapped_column(String(64), unique=True)
    width: Mapped[int]
    height: Mapped[int]
    # Average colour as #rrggbb; clients use it to tint the glass UI.
    color: Mapped[str] = mapped_column(String(7))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Artist(UUIDPk, Base):
    __tablename__ = "artists"

    name: Mapped[str] = mapped_column(String(512))
    name_key: Mapped[str] = mapped_column(String(512), unique=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (
        Index(
            "ix_artists_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
    )


class Album(UUIDPk, Base):
    __tablename__ = "albums"

    title: Mapped[str] = mapped_column(String(512))
    title_key: Mapped[str] = mapped_column(String(512))
    artist_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("artists.id", ondelete="CASCADE"))
    year: Mapped[int | None]
    genre: Mapped[str | None] = mapped_column(String(128))
    cover_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("covers.id", ondelete="SET NULL"))
    added_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)

    artist: Mapped[Artist] = relationship(lazy="raise")
    cover: Mapped[Cover | None] = relationship(lazy="raise")

    __table_args__ = (
        UniqueConstraint("artist_id", "title_key", name="uq_albums_artist_title"),
        Index(
            "ix_albums_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
    )


class Track(UUIDPk, Base):
    __tablename__ = "tracks"

    title: Mapped[str] = mapped_column(String(512))
    album_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("albums.id", ondelete="CASCADE"), index=True
    )
    # Track artist; may differ from the album artist on compilations.
    artist_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("artists.id", ondelete="CASCADE"), index=True
    )
    disc_no: Mapped[int | None]
    track_no: Mapped[int | None]
    duration_ms: Mapped[int]

    # Path relative to the library root; identity of the track.
    path: Mapped[str] = mapped_column(String(2048), unique=True)
    size: Mapped[int] = mapped_column(BigInteger)
    mtime: Mapped[float]
    codec: Mapped[str] = mapped_column(String(32))
    bitrate: Mapped[int | None]
    sample_rate: Mapped[int | None]

    added_at: Mapped[datetime] = mapped_column(default=utcnow)

    album: Mapped[Album] = relationship(lazy="raise")
    artist: Mapped[Artist] = relationship(lazy="raise")

    __table_args__ = (
        Index(
            "ix_tracks_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
    )


class Variant(enum.StrEnum):
    high = "high"  # Opus 160 kbit/s
    low = "low"  # Opus 96 kbit/s


VARIANT_BITRATES = {Variant.high: 160, Variant.low: 96}


class TrackFile(UUIDPk, Base):
    """A transcoded rendition of a track. The original file is served from Track.path."""

    __tablename__ = "track_files"

    track_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tracks.id", ondelete="CASCADE"))
    variant: Mapped[Variant] = mapped_column(Enum(Variant, name="track_variant"))
    path: Mapped[str] = mapped_column(String(2048))
    mime: Mapped[str] = mapped_column(String(64))
    bitrate: Mapped[int]
    size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    __table_args__ = (UniqueConstraint("track_id", "variant", name="uq_track_files_track_variant"),)
