import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.deps import CurrentUser, SessionDep
from app.library.models import Album, Track
from app.library.queries import ALBUM_LOAD, albums_out
from app.me.models import PlayEvent, TrackLike
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
    session: AsyncSession, user_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[AlbumOut]:
    if not ids:
        return []
    by_id = {
        a.id: a
        for a in await session.scalars(select(Album).where(Album.id.in_(ids)).options(*ALBUM_LOAD))
    }
    return await albums_out(session, user_id, [by_id[i] for i in ids if i in by_id])


async def _recently_played(
    session: AsyncSession, user_id: uuid.UUID, limit: int
) -> list[uuid.UUID]:
    return list(
        await session.scalars(
            select(Track.album_id)
            .join(PlayEvent, PlayEvent.track_id == Track.id)
            .where(PlayEvent.user_id == user_id)
            .group_by(Track.album_id)
            .order_by(func.max(PlayEvent.played_at).desc())
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
        ever_played = (
            select(Track.album_id)
            .join(PlayEvent, PlayEvent.track_id == Track.id)
            .where(PlayEvent.user_id == user_id)
        )
        fill = select(Album.id).where(Album.id.not_in(ever_played))
        if picked:
            fill = fill.where(Album.id.not_in(picked))
        picked += list(
            await session.scalars(fill.order_by(func.random()).limit(limit - len(picked)))
        )
    return picked


@router.get("/home", response_model=HomeOut)
async def get_home(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=50)] = 12,
) -> HomeOut:
    added_ids = list(
        await session.scalars(
            select(Album.id).order_by(Album.added_at.desc(), Album.id).limit(limit)
        )
    )
    released_ids = list(
        await session.scalars(
            select(Album.id)
            .where(Album.year.is_not(None))
            .order_by(Album.year.desc(), Album.added_at.desc(), Album.id)
            .limit(limit)
        )
    )
    return HomeOut(
        recently_added=await _albums_by_ids(session, user.id, added_ids),
        new_releases=await _albums_by_ids(session, user.id, released_ids),
        recently_played=await _albums_by_ids(
            session, user.id, await _recently_played(session, user.id, limit)
        ),
        for_you=await _albums_by_ids(session, user.id, await _for_you(session, user.id, limit)),
    )
