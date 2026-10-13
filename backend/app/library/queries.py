"""Loading and serialising catalog entities consistently across routers."""

import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy import Select, func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, selectinload
from sqlalchemy.orm.interfaces import LoaderOption

from app.library.covers import palette_from_color
from app.library.models import Album, Artist, Cover, Track, TrackArtist
from app.me.models import AlbumLike, ArtistLike, TrackLike
from app.schemas import AlbumOut, AlbumRef, ArtistOut, ArtistRef, CoverPalette, TrackOut

TRACK_LOAD: list[LoaderOption] = [
    selectinload(Track.artist),
    selectinload(Track.credits).selectinload(TrackArtist.artist),
    selectinload(Track.album).selectinload(Album.cover),
    selectinload(Track.album).selectinload(Album.artist),
    selectinload(Track.cover),
]
ALBUM_LOAD: list[LoaderOption] = [selectinload(Album.artist), selectinload(Album.cover)]

TRACK_ORDER = (Track.disc_no.nulls_first(), Track.track_no.nulls_last(), Track.title)


def contains(q: str) -> str:
    """ILIKE pattern matching `q` anywhere, with LIKE wildcards escaped (escape char: \\)."""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def track_select() -> Select[Track]:
    return select(Track).options(*TRACK_LOAD)


async def _liked(
    session: AsyncSession,
    like_model: type[TrackLike] | type[AlbumLike] | type[ArtistLike],
    item_column: InstrumentedAttribute[uuid.UUID],
    user_id: uuid.UUID,
    item_ids: Iterable[uuid.UUID],
) -> set[uuid.UUID]:
    ids = list(item_ids)
    if not ids:
        return set()
    rows = await session.scalars(
        select(item_column).where(like_model.user_id == user_id, item_column.in_(ids))
    )
    return set(rows)


async def liked_ids(
    session: AsyncSession, user_id: uuid.UUID, track_ids: Iterable[uuid.UUID]
) -> set[uuid.UUID]:
    return await _liked(session, TrackLike, TrackLike.track_id, user_id, track_ids)


def cover_palette(cover: Cover | None) -> CoverPalette | None:
    if cover is None:
        return None
    return CoverPalette.model_validate(cover.palette or palette_from_color(cover.color))


def album_ref(album: Album) -> AlbumRef:
    return AlbumRef(
        id=album.id,
        title=album.title,
        cover_id=album.cover_id,
        cover_palette=cover_palette(album.cover),
    )


def track_out(track: Track, liked: set[uuid.UUID] | None = None) -> TrackOut:
    cover = track.cover or track.album.cover
    return TrackOut(
        id=track.id,
        title=track.title,
        duration_ms=track.duration_ms,
        track_no=track.track_no,
        disc_no=track.disc_no,
        codec=track.codec,
        bitrate=track.bitrate,
        artist=ArtistRef(id=track.artist.id, name=track.artist.name),
        artists=[ArtistRef(id=c.artist.id, name=c.artist.name) for c in track.credits]
        or [ArtistRef(id=track.artist.id, name=track.artist.name)],
        album=album_ref(track.album),
        album_artist=ArtistRef(id=track.album.artist.id, name=track.album.artist.name),
        cover_id=cover.id if cover else None,
        cover_palette=cover_palette(cover),
        liked=liked is not None and track.id in liked,
    )


async def tracks_out(
    session: AsyncSession, user_id: uuid.UUID, tracks: Sequence[Track]
) -> list[TrackOut]:
    liked = await liked_ids(session, user_id, (t.id for t in tracks))
    return [track_out(t, liked) for t in tracks]


def album_out(album: Album, liked: set[uuid.UUID] | None = None) -> AlbumOut:
    return AlbumOut(
        id=album.id,
        title=album.title,
        year=album.year,
        genre=album.genre,
        artist=ArtistRef(id=album.artist.id, name=album.artist.name),
        cover_id=album.cover_id,
        cover_palette=cover_palette(album.cover),
        added_at=album.added_at,
        liked=liked is not None and album.id in liked,
    )


async def albums_out(
    session: AsyncSession, user_id: uuid.UUID, albums: Sequence[Album]
) -> list[AlbumOut]:
    liked = await _liked(session, AlbumLike, AlbumLike.album_id, user_id, (a.id for a in albums))
    return [album_out(a, liked) for a in albums]


async def artists_out(
    session: AsyncSession, user_id: uuid.UUID, artists: Sequence[Artist]
) -> list[ArtistOut]:
    """Adds album counts, a representative cover (newest album with artwork) and the like."""
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
        ).all()
    )
    covers: dict[uuid.UUID, Cover] = dict(
        (
            await session.execute(
                select(Album.artist_id, Cover)
                .join(Cover, Cover.id == Album.cover_id)
                .where(Album.artist_id.in_(ids))
                .ext(distinct_on(Album.artist_id))
                .order_by(Album.artist_id, Album.year.desc().nulls_last(), Album.added_at.desc())
            )
        ).all()
    )
    liked = await _liked(session, ArtistLike, ArtistLike.artist_id, user_id, ids)
    return [
        ArtistOut(
            id=a.id,
            name=a.name,
            cover_id=cover.id if (cover := covers.get(a.id)) else None,
            cover_palette=cover_palette(cover),
            album_count=counts.get(a.id, 0),
            liked=a.id in liked,
        )
        for a in artists
    ]
