"""The long lists (all tracks, albums and artists, and the user's liked ones) filtered by
artist, album and genre, and the choices each filter offers on them."""

import enum
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import ColumnElement, Select, Subquery, func, literal, or_, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import CurrentUser, SessionDep
from app.library.models import Album, Artist, Track, TrackArtist
from app.library.queries import contains
from app.me.models import AlbumLike, ArtistLike, TrackLike
from app.schemas import ApiModel

router = APIRouter(prefix="/filters", tags=["library"])

GenreParam = Annotated[str | None, Query(max_length=128)]


@dataclass
class Filters:
    artist_id: uuid.UUID | None = None
    album_id: uuid.UUID | None = None
    genre: str | None = None


def same_genre(column: Any, genre: str) -> ColumnElement[bool]:
    """Spellings differing in case are one genre."""
    return func.lower(column) == func.lower(literal(genre))


def track_filters(filters: Filters) -> list[ColumnElement[bool]]:
    """Tracks the artist is credited on or that are on their albums (a compilation's), on
    the album, on albums of the genre."""
    where = []
    if artist := filters.artist_id:
        where.append(
            or_(
                Track.id.in_(select(TrackArtist.track_id).where(TrackArtist.artist_id == artist)),
                Track.album_id.in_(select(Album.id).where(Album.artist_id == artist)),
            )
        )
    if filters.album_id:
        where.append(Track.album_id == filters.album_id)
    if filters.genre:
        where.append(
            Track.album_id.in_(select(Album.id).where(same_genre(Album.genre, filters.genre)))
        )
    return where


def album_filters(filters: Filters) -> list[ColumnElement[bool]]:
    """Albums by the artist (their album artist), of the genre."""
    where = []
    if filters.artist_id:
        where.append(Album.artist_id == filters.artist_id)
    if filters.genre:
        where.append(same_genre(Album.genre, filters.genre))
    return where


def _artist_genres() -> Subquery:
    """(artist_id, genre) of each album an artist made or is credited on."""
    own = select(Album.artist_id.label("artist_id"), Album.genre.label("genre"))
    credited = (
        select(TrackArtist.artist_id.label("artist_id"), Album.genre.label("genre"))
        .join(Track, Track.id == TrackArtist.track_id)
        .join(Album, Album.id == Track.album_id)
    )
    return union(own, credited).subquery()


def artist_filters(filters: Filters) -> list[ColumnElement[bool]]:
    """Artists with an album of the genre: of their own or one they are credited on."""
    if not filters.genre:
        return []
    pairs = _artist_genres()
    return [
        Artist.id.in_(select(pairs.c.artist_id).where(same_genre(pairs.c.genre, filters.genre)))
    ]


class FilterScope(enum.StrEnum):
    """The list a filter's choices are for."""

    tracks = "tracks"
    liked_tracks = "liked_tracks"
    albums = "albums"
    liked_albums = "liked_albums"
    artists = "artists"
    liked_artists = "liked_artists"


_TRACKS = {FilterScope.tracks, FilterScope.liked_tracks}
_ALBUMS = {FilterScope.albums, FilterScope.liked_albums}


class FilterChoice(ApiModel):
    # What the filter is set to: an artist's or album's id, a genre's name.
    value: str
    name: str
    # Whose album it is.
    detail: str | None = None


class FilterOption(FilterChoice):
    # How many of the list's items it leaves, the other filters set.
    count: int


class FilterOptions(ApiModel):
    items: list[FilterOption]
    # Choices in all (matching `q`), of which `items` are the first.
    total: int
    # The filter's current setting, named.
    selected: FilterChoice | None = None


def _track_ids(scope: FilterScope, user_id: uuid.UUID, filters: Filters) -> Select:
    query = select(Track.id).where(*track_filters(filters))
    if scope == FilterScope.liked_tracks:
        query = query.join(TrackLike, TrackLike.track_id == Track.id).where(
            TrackLike.user_id == user_id
        )
    return query


def _album_ids(scope: FilterScope, user_id: uuid.UUID, filters: Filters) -> Select:
    query = select(Album.id).where(*album_filters(filters))
    if scope == FilterScope.liked_albums:
        query = query.join(AlbumLike, AlbumLike.album_id == Album.id).where(
            AlbumLike.user_id == user_id
        )
    return query


def _artist_ids(scope: FilterScope, user_id: uuid.UUID) -> Select:
    query = select(Artist.id)
    if scope == FilterScope.liked_artists:
        query = query.join(ArtistLike, ArtistLike.artist_id == Artist.id).where(
            ArtistLike.user_id == user_id
        )
    return query


def _unsupported(scope: FilterScope, facet: str) -> HTTPException:
    return HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT, f"The {scope} list has no {facet} filter"
    )


async def _options(
    session: AsyncSession,
    counted: Select,
    order: Callable[[Subquery], tuple],
    limit: int,
) -> FilterOptions:
    """`counted`: each choice's value, name, detail and count, and `key` to sort by. With
    `limit` 0, none are counted: the caller only names what the filter is set to."""
    if limit == 0:
        return FilterOptions(items=[], total=0)
    rows = counted.subquery()
    total = await session.scalar(select(func.count()).select_from(rows)) or 0
    items = [
        FilterOption(value=str(r.value), name=r.name, detail=r.detail, count=r.count)
        for r in await session.execute(select(rows).order_by(*order(rows)).limit(limit))
    ]
    return FilterOptions(items=items, total=total)


def _by_name(rows: Subquery) -> tuple:
    return rows.c.key, rows.c.value


Q = Annotated[str | None, Query(max_length=200)]
# 0: no choices, only `selected` (to name a filter that is set).
Limit = Annotated[int, Query(ge=0, le=200)]


@router.get("/artists", response_model=FilterOptions)
async def artist_filter_options(
    session: SessionDep,
    user: CurrentUser,
    scope: FilterScope,
    album_id: uuid.UUID | None = None,
    genre: GenreParam = None,
    artist_id: uuid.UUID | None = None,
    q: Q = None,
    limit: Limit = 50,
) -> FilterOptions:
    """The artists a list of tracks or albums can be filtered by, A to Z, with how many of
    its items each leaves (the other filters set): of tracks, those credited and the album
    artists; of albums, the album artists. `artist_id` is the one chosen."""
    others = Filters(album_id=album_id, genre=genre)
    if scope in _TRACKS:
        ids = _track_ids(scope, user.id, others)
        pairs = union(
            select(TrackArtist.artist_id, TrackArtist.track_id.label("item_id")).where(
                TrackArtist.track_id.in_(ids)
            ),
            select(Album.artist_id, Track.id.label("item_id"))
            .join(Album, Album.id == Track.album_id)
            .where(Track.id.in_(ids)),
        ).subquery()
    elif scope in _ALBUMS:
        pairs = (
            select(Album.artist_id, Album.id.label("item_id"))
            .where(Album.id.in_(_album_ids(scope, user.id, others)))
            .subquery()
        )
    else:
        raise _unsupported(scope, "artist")
    counted = (
        select(
            Artist.id.label("value"),
            Artist.name.label("name"),
            literal(None).label("detail"),
            func.count(pairs.c.item_id.distinct()).label("count"),
            Artist.name_key.label("key"),
        )
        .join(pairs, pairs.c.artist_id == Artist.id)
        .group_by(Artist.id)
    )
    if q:
        counted = counted.where(Artist.name.ilike(contains(q), escape="\\"))
    options = await _options(session, counted, _by_name, limit)
    if artist_id and (
        name := await session.scalar(select(Artist.name).where(Artist.id == artist_id))
    ):
        options.selected = FilterChoice(value=str(artist_id), name=name)
    return options


@router.get("/albums", response_model=FilterOptions)
async def album_filter_options(
    session: SessionDep,
    user: CurrentUser,
    scope: FilterScope,
    artist_id: uuid.UUID | None = None,
    genre: GenreParam = None,
    album_id: uuid.UUID | None = None,
    q: Q = None,
    limit: Limit = 50,
) -> FilterOptions:
    """The albums a list of tracks can be filtered by, A to Z, each with its artist and how
    many of the tracks it holds (the other filters set); `q` matches either. `album_id` is
    the one chosen."""
    if scope not in _TRACKS:
        raise _unsupported(scope, "album")
    ids = _track_ids(scope, user.id, Filters(artist_id=artist_id, genre=genre))
    counted = (
        select(
            Album.id.label("value"),
            Album.title.label("name"),
            Artist.name.label("detail"),
            func.count().label("count"),
            Album.title_key.label("key"),
        )
        .join(Track, Track.album_id == Album.id)
        .join(Artist, Artist.id == Album.artist_id)
        .where(Track.id.in_(ids))
        .group_by(Album.id, Artist.id)
    )
    if q:
        pattern = contains(q)
        counted = counted.where(
            or_(Album.title.ilike(pattern, escape="\\"), Artist.name.ilike(pattern, escape="\\"))
        )
    options = await _options(session, counted, _by_name, limit)
    if album_id:
        chosen = (
            await session.execute(
                select(Album.title, Artist.name)
                .join(Artist, Artist.id == Album.artist_id)
                .where(Album.id == album_id)
            )
        ).first()
        if chosen is not None:
            options.selected = FilterChoice(value=str(album_id), name=chosen[0], detail=chosen[1])
    return options


@router.get("/genres", response_model=FilterOptions)
async def genre_filter_options(
    session: SessionDep,
    user: CurrentUser,
    scope: FilterScope,
    artist_id: uuid.UUID | None = None,
    album_id: uuid.UUID | None = None,
    genre: GenreParam = None,
    q: Q = None,
    limit: Limit = 50,
) -> FilterOptions:
    """The genres a list can be filtered by, those leaving the most of it first (the other
    filters set). Spellings differing in case are one genre. `genre` is the one chosen."""
    others = Filters(artist_id=artist_id, album_id=album_id)
    if scope in _TRACKS:
        pairs = (
            select(Album.genre.label("genre"), Track.id.label("item_id"))
            .join(Album, Album.id == Track.album_id)
            .where(Track.id.in_(_track_ids(scope, user.id, others)))
        )
    elif scope in _ALBUMS:
        pairs = select(Album.genre.label("genre"), Album.id.label("item_id")).where(
            Album.id.in_(_album_ids(scope, user.id, others))
        )
    else:
        every = _artist_genres()
        pairs = select(every.c.genre, every.c.artist_id.label("item_id")).where(
            every.c.artist_id.in_(_artist_ids(scope, user.id))
        )
    rows = pairs.subquery()
    key = func.lower(rows.c.genre)
    counted = (
        select(
            func.min(rows.c.genre).label("value"),
            func.min(rows.c.genre).label("name"),
            literal(None).label("detail"),
            func.count(rows.c.item_id.distinct()).label("count"),
            key.label("key"),
        )
        .where(rows.c.genre.is_not(None))
        .group_by(key)
    )
    if q:
        counted = counted.where(rows.c.genre.ilike(contains(q), escape="\\"))
    options = await _options(session, counted, lambda r: (r.c.count.desc(), r.c.key), limit)
    if genre:
        # As the albums spell it.
        name = await session.scalar(
            select(func.min(Album.genre)).where(same_genre(Album.genre, genre))
        )
        options.selected = FilterChoice(value=name or genre, name=name or genre)
    return options
