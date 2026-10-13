"""Loading and serialising catalog entities consistently across routers."""

import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.interfaces import LoaderOption

from app.library.models import Album, Artist, Track
from app.me.models import TrackLike
from app.schemas import AlbumOut, AlbumRef, ArtistOut, ArtistRef, TrackOut

TRACK_LOAD: list[LoaderOption] = [
    selectinload(Track.artist),
    selectinload(Track.album).selectinload(Album.cover),
    selectinload(Track.album).selectinload(Album.artist),
]
ALBUM_LOAD: list[LoaderOption] = [selectinload(Album.artist), selectinload(Album.cover)]

TRACK_ORDER = (Track.disc_no.nulls_first(), Track.track_no.nulls_last(), Track.title)


def contains(q: str) -> str:
    """ILIKE pattern matching `q` anywhere, with LIKE wildcards escaped (escape char: \\)."""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def track_select() -> Select[Track]:
    return select(Track).options(*TRACK_LOAD)


async def liked_ids(
    session: AsyncSession, user_id: uuid.UUID, track_ids: Iterable[uuid.UUID]
) -> set[uuid.UUID]:
    ids = list(track_ids)
    if not ids:
        return set()
    rows = await session.scalars(
        select(TrackLike.track_id).where(TrackLike.user_id == user_id, TrackLike.track_id.in_(ids))
    )
    return set(rows)


def album_ref(album: Album) -> AlbumRef:
    return AlbumRef(
        id=album.id,
        title=album.title,
        cover_id=album.cover_id,
        cover_color=album.cover.color if album.cover else None,
    )


def track_out(track: Track, liked: set[uuid.UUID] | None = None) -> TrackOut:
    return TrackOut(
        id=track.id,
        title=track.title,
        duration_ms=track.duration_ms,
        track_no=track.track_no,
        disc_no=track.disc_no,
        codec=track.codec,
        bitrate=track.bitrate,
        artist=ArtistRef(id=track.artist.id, name=track.artist.name),
        album=album_ref(track.album),
        album_artist=ArtistRef(id=track.album.artist.id, name=track.album.artist.name),
        liked=liked is not None and track.id in liked,
    )


async def tracks_out(
    session: AsyncSession, user_id: uuid.UUID, tracks: Sequence[Track]
) -> list[TrackOut]:
    liked = await liked_ids(session, user_id, (t.id for t in tracks))
    return [track_out(t, liked) for t in tracks]


def album_out(album: Album) -> AlbumOut:
    return AlbumOut(
        id=album.id,
        title=album.title,
        year=album.year,
        genre=album.genre,
        artist=ArtistRef(id=album.artist.id, name=album.artist.name),
        cover_id=album.cover_id,
        cover_color=album.cover.color if album.cover else None,
        added_at=album.added_at,
    )


async def artists_out(session: AsyncSession, artists: Sequence[Artist]) -> list[ArtistOut]:
    """Adds album counts and a representative cover (newest album with artwork)."""
    ids = [a.id for a in artists]
    if not ids:
        return []
    counts = dict(
        (
            await session.execute(
                select(Album.artist_id, func.count())
                .where(Album.artist_id.in_(ids))
                .group_by(Album.artist_id)
            )
        )
        .tuples()
        .all()
    )
    covers = dict(
        (
            await session.execute(
                select(Album.artist_id, Album.cover_id)
                .where(Album.artist_id.in_(ids), Album.cover_id.is_not(None))
                .distinct(Album.artist_id)
                .order_by(Album.artist_id, Album.year.desc().nulls_last(), Album.added_at.desc())
            )
        )
        .tuples()
        .all()
    )
    return [
        ArtistOut(id=a.id, name=a.name, cover_id=covers.get(a.id), album_count=counts.get(a.id, 0))
        for a in artists
    ]
