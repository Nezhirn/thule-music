import uuid
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Query
from sqlalchemy import Row, exists, func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.deps import CurrentUser, SessionDep
from app.library.models import Album, Track
from app.library.queries import ALBUM_LOAD, albums_out
from app.me.models import PlayEvent, TrackLike
from app.me.router import RECENT_PLAYS
from app.schemas import AlbumOut, ApiModel

router = APIRouter(tags=["home"])

AFFINITY_WINDOW = timedelta(days=90)
RECENTLY_PLAYED_WINDOW = timedelta(days=14)
LIKE_WEIGHT = 5
# Plays shorter than this are treated as skips.
MIN_LISTEN_MS = 30_000


class HomeOut(ApiModel):
    # Newest in the library.
    recently_added: list[AlbumOut]
    # Newest by release year.
    new_releases: list[AlbumOut]
    recently_played: list[AlbumOut]
    for_you: list[AlbumOut]


async def _albums_by_ids(
    session: AsyncSession, user_id: uuid.UUID, lists: list[list[uuid.UUID]]
) -> list[list[AlbumOut]]:
    """The albums of several lists of ids, in their order: one query for all of them."""
    ids = {i for ids in lists for i in ids}
    if not ids:
        return [[] for _ in lists]
    albums = await session.scalars(select(Album).where(Album.id.in_(ids)).options(*ALBUM_LOAD))
    by_id = {a.id: a for a in await albums_out(session, user_id, list(albums))}
    return [[by_id[i] for i in ids if i in by_id] for ids in lists]


async def _recently_played(
    session: AsyncSession, user_id: uuid.UUID, limit: int
) -> list[uuid.UUID]:
    # Among the latest plays only (newest first along the index): the history grows for ever.
    plays = (
        select(PlayEvent.track_id, PlayEvent.played_at)
        .where(PlayEvent.user_id == user_id)
        .order_by(PlayEvent.played_at.desc())
        .limit(RECENT_PLAYS)
        .subquery()
    )
    return list(
        await session.scalars(
            select(Track.album_id)
            .join(plays, plays.c.track_id == Track.id)
            .group_by(Track.album_id)
            .order_by(func.max(plays.c.played_at).desc())
            .limit(limit)
        )
    )


async def _for_you(session: AsyncSession, user_id: uuid.UUID, limit: int) -> list[uuid.UUID]:
    """Albums by the artists you play and like most, skipping what you played lately;
    topped up with albums you have never played."""
    now = utcnow()
    plays = (
        select(Track.artist_id.label("artist_id"), func.count().label("score"))
        .join(PlayEvent, PlayEvent.track_id == Track.id)
        .where(
            PlayEvent.user_id == user_id,
            PlayEvent.played_at >= now - AFFINITY_WINDOW,
            func.coalesce(PlayEvent.listened_ms, MIN_LISTEN_MS) >= MIN_LISTEN_MS,
        )
        .group_by(Track.artist_id)
    )
    likes = (
        select(Track.artist_id.label("artist_id"), (func.count() * LIKE_WEIGHT).label("score"))
        .join(TrackLike, TrackLike.track_id == Track.id)
        .where(TrackLike.user_id == user_id)
        .group_by(Track.artist_id)
    )
    scores = plays.union_all(likes).subquery()
    affinity = (
        select(scores.c.artist_id, func.sum(scores.c.score).label("score"))
        .group_by(scores.c.artist_id)
        .subquery()
    )
    recent_albums = (
        select(Track.album_id)
        .join(PlayEvent, PlayEvent.track_id == Track.id)
        .where(PlayEvent.user_id == user_id, PlayEvent.played_at >= now - RECENTLY_PLAYED_WINDOW)
    )
    # Album affinity: best score among artists credited on any of its tracks.
    album_scores = (
        select(Track.album_id, func.max(affinity.c.score).label("score"))
        .join(affinity, affinity.c.artist_id == Track.artist_id)
        .group_by(Track.album_id)
        .subquery()
    )
    picked = list(
        await session.scalars(
            select(album_scores.c.album_id)
            .where(album_scores.c.album_id.not_in(recent_albums))
            .order_by(album_scores.c.score.desc(), func.random())
            .limit(limit)
        )
    )
    if len(picked) < limit:
        # An anti-join: NOT IN over every play ever would be read whole for each album.
        played = (
            exists()
            .where(Track.album_id == Album.id, PlayEvent.track_id == Track.id)
            .where(PlayEvent.user_id == user_id)
        )
        fill = select(Album.id).where(~played)
        if picked:
            fill = fill.where(Album.id.not_in(picked))
        picked += list(
            await session.scalars(fill.order_by(func.random()).limit(limit - len(picked)))
        )
    return picked


def _newest_first(row: Row[Any]) -> tuple[float, str]:
    return -row.added_at.timestamp(), str(row.id)


def _newest_release_first(row: Row[Any]) -> tuple[int, float, str]:
    return -row.year, -row.added_at.timestamp(), str(row.id)


@router.get("/home", response_model=HomeOut)
async def get_home(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
) -> HomeOut:
    columns = (Album.id, Album.added_at, Album.year)
    newest = select(*columns).order_by(Album.added_at.desc(), Album.id).limit(limit).subquery()
    released = (
        select(*columns)
        .where(Album.year.is_not(None))
        .order_by(Album.year.desc(), Album.added_at.desc(), Album.id)
        .limit(limit)
        .subquery()
    )
    # Both shelves in one query (each query is a round trip to the database), put back in
    # their order here: a union doesn't keep it.
    rows = (
        await session.execute(
            union_all(
                select(literal("added").label("shelf"), *newest.c),
                select(literal("released").label("shelf"), *released.c),
            )
        )
    ).all()
    added_ids = [r.id for r in sorted((r for r in rows if r.shelf == "added"), key=_newest_first)]
    released_ids = [
        r.id for r in sorted((r for r in rows if r.shelf == "released"), key=_newest_release_first)
    ]
    played_ids = await _recently_played(session, user.id, limit)
    for_you_ids = await _for_you(session, user.id, limit)
    added, new, played, for_you = await _albums_by_ids(
        session, user.id, [added_ids, released_ids, played_ids, for_you_ids]
    )
    return HomeOut(recently_added=added, new_releases=new, recently_played=played, for_you=for_you)
