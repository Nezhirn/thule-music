import enum
import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.deps import CurrentUser, SessionDep
from app.errors import ApiError, ErrorCode
from app.library.models import Album, Artist, Track, TrackArtist
from app.library.queries import (
    ALBUM_LOAD,
    TRACK_ORDER,
    albums_out,
    artists_out,
    contains,
    track_select,
    tracks_out,
)
from app.me.models import PlayEvent
from app.schemas import (
    AlbumDetail,
    AlbumOut,
    ArtistDetail,
    ArtistOut,
    GenreOut,
    Page,
    TrackOut,
)

router = APIRouter(tags=["library"])

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


class AlbumSort(enum.StrEnum):
    by_added = "added"
    by_title = "title"
    by_year = "year"
    by_artist = "artist"


class TrackSort(enum.StrEnum):
    by_added = "added"
    by_title = "title"
    by_artist = "artist"
    by_album = "album"


@router.get("/artists", response_model=Page[ArtistOut])
async def list_artists(
    session: SessionDep,
    user: CurrentUser,
    limit: Limit = 50,
    offset: Offset = 0,
    q: str | None = None,
) -> Page[ArtistOut]:
    query = select(Artist)
    if q:
        query = query.where(Artist.name.ilike(contains(q), escape="\\"))
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    artists = (
        await session.scalars(query.order_by(Artist.name_key).limit(limit).offset(offset))
    ).all()
    return Page(
        items=await artists_out(session, user.id, artists), total=total, limit=limit, offset=offset
    )


@router.get("/artists/{artist_id}", response_model=ArtistDetail)
async def get_artist(artist_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> ArtistDetail:
    artist = await session.get(Artist, artist_id)
    if artist is None:
        raise ApiError(ErrorCode.artist_not_found)
    newest_first = (Album.year.desc().nulls_last(), Album.title_key)
    albums = (
        await session.scalars(
            select(Album)
            .where(Album.artist_id == artist_id)
            .options(*ALBUM_LOAD)
            .order_by(*newest_first)
        )
    ).all()
    credited = select(TrackArtist.track_id).where(TrackArtist.artist_id == artist_id)
    appears_on = (
        await session.scalars(
            select(Album)
            .where(
                Album.artist_id != artist_id,
                Album.id.in_(select(Track.album_id).where(Track.id.in_(credited))),
            )
            .options(*ALBUM_LOAD)
            .order_by(*newest_first)
        )
    ).all()

    plays = (
        select(PlayEvent.track_id, func.count().label("n")).group_by(PlayEvent.track_id).subquery()
    )
    top = (
        await session.scalars(
            track_select()
            .outerjoin(plays, plays.c.track_id == Track.id)
            .where(Track.id.in_(credited))
            .order_by(func.coalesce(plays.c.n, 0).desc(), *TRACK_ORDER)
            .limit(10)
        )
    ).all()

    (base,) = await artists_out(session, user.id, [artist])
    return ArtistDetail(
        **base.model_dump(),
        cover_custom=artist.cover_id is not None,
        albums=await albums_out(session, user.id, albums),
        appears_on=await albums_out(session, user.id, appears_on),
        top_tracks=await tracks_out(session, user.id, top),
    )


@router.get("/albums", response_model=Page[AlbumOut])
async def list_albums(
    session: SessionDep,
    user: CurrentUser,
    limit: Limit = 50,
    offset: Offset = 0,
    sort: AlbumSort = AlbumSort.by_added,
    q: str | None = None,
    genre: str | None = None,
) -> Page[AlbumOut]:
    query = select(Album)
    if q:
        query = query.where(Album.title.ilike(contains(q), escape="\\"))
    if genre:
        query = query.where(func.lower(Album.genre) == genre.casefold())
    if sort == AlbumSort.by_artist:
        query = query.join(Artist, Artist.id == Album.artist_id)
    order = {
        AlbumSort.by_added: (Album.added_at.desc(), Album.id),
        AlbumSort.by_title: (Album.title_key, Album.id),
        AlbumSort.by_year: (Album.year.desc().nulls_last(), Album.title_key, Album.id),
        AlbumSort.by_artist: (
            Artist.name_key,
            Album.year.nulls_last(),
            Album.title_key,
            Album.id,
        ),
    }[sort]
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    albums = (
        await session.scalars(
            query.options(*ALBUM_LOAD).order_by(*order).limit(limit).offset(offset)
        )
    ).all()
    return Page(
        items=await albums_out(session, user.id, albums), total=total, limit=limit, offset=offset
    )


@router.get("/albums/{album_id}", response_model=AlbumDetail)
async def get_album(album_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> AlbumDetail:
    album = await session.scalar(select(Album).where(Album.id == album_id).options(*ALBUM_LOAD))
    if album is None:
        raise ApiError(ErrorCode.album_not_found)
    tracks = (
        await session.scalars(
            track_select().where(Track.album_id == album_id).order_by(*TRACK_ORDER)
        )
    ).all()
    return AlbumDetail(
        **(await albums_out(session, user.id, [album]))[0].model_dump(),
        duration_ms=sum(t.duration_ms for t in tracks),
        cover_custom=album.cover_custom,
        tracks=await tracks_out(session, user.id, tracks),
    )


@router.get("/tracks", response_model=Page[TrackOut])
async def list_tracks(
    session: SessionDep,
    user: CurrentUser,
    limit: Limit = 50,
    offset: Offset = 0,
    sort: TrackSort = TrackSort.by_added,
) -> Page[TrackOut]:
    query = track_select()
    if sort == TrackSort.by_artist:
        query = query.join(Artist, Artist.id == Track.artist_id)
    if sort != TrackSort.by_title:
        query = query.join(Album, Album.id == Track.album_id)
    in_album = (*TRACK_ORDER, Track.id)
    order = {
        # Newest albums first, each in its own order: the tracks of one scan were added
        # moments apart, in no particular order.
        TrackSort.by_added: (Album.added_at.desc(), Album.id, *in_album),
        TrackSort.by_title: (func.lower(Track.title), Track.id),
        TrackSort.by_artist: (Artist.name_key, Album.year.nulls_last(), Album.title_key, *in_album),
        TrackSort.by_album: (Album.title_key, Album.id, *in_album),
    }[sort]
    total = await session.scalar(select(func.count()).select_from(Track)) or 0
    tracks = (await session.scalars(query.order_by(*order).limit(limit).offset(offset))).all()
    return Page(
        items=await tracks_out(session, user.id, tracks), total=total, limit=limit, offset=offset
    )


@router.get("/tracks/{track_id}", response_model=TrackOut)
async def get_track(track_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> TrackOut:
    track = await session.scalar(track_select().where(Track.id == track_id))
    if track is None:
        raise ApiError(ErrorCode.track_not_found)
    (out,) = await tracks_out(session, user.id, [track])
    return out


@router.get("/genres", response_model=list[GenreOut])
async def list_genres(session: SessionDep, _: CurrentUser) -> list[GenreOut]:
    """Album genres, most albums first. Spellings differing only in case count as one."""
    key = func.lower(Album.genre)
    rows = await session.execute(
        select(func.min(Album.genre), func.count())
        .where(Album.genre.is_not(None))
        .group_by(key)
        .order_by(func.count().desc(), key)
    )
    return [GenreOut(name=name, album_count=count) for name, count in rows]
