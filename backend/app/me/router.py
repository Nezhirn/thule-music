import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert

from app.db import utcnow
from app.deps import CurrentUser, SessionDep
from app.library.models import Track
from app.library.queries import track_out, track_select
from app.me.models import PlayEvent, TrackLike
from app.schemas import Page, TrackOut

router = APIRouter(prefix="/me", tags=["me"])


class PlayIn(BaseModel):
    track_id: uuid.UUID
    played_at: datetime | None = None
    listened_ms: int | None = Field(default=None, ge=0)


class RecentTrack(BaseModel):
    played_at: datetime
    track: TrackOut


async def _ensure_track(session, track_id: uuid.UUID) -> None:
    if await session.get(Track, track_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Track not found")


@router.put("/likes/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def like(track_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await _ensure_track(session, track_id)
    await session.execute(
        insert(TrackLike).values(user_id=user.id, track_id=track_id).on_conflict_do_nothing()
    )
    await session.commit()


@router.delete("/likes/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlike(track_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await session.execute(
        delete(TrackLike).where(TrackLike.user_id == user.id, TrackLike.track_id == track_id)
    )
    await session.commit()


@router.get("/likes/tracks", response_model=Page[TrackOut])
async def liked_tracks(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[TrackOut]:
    """The virtual "Liked Music" playlist, newest first."""
    total = (
        await session.scalar(
            select(func.count()).select_from(TrackLike).where(TrackLike.user_id == user.id)
        )
        or 0
    )
    tracks = (
        await session.scalars(
            track_select()
            .join(TrackLike, TrackLike.track_id == Track.id)
            .where(TrackLike.user_id == user.id)
            .order_by(TrackLike.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    liked = {t.id for t in tracks}
    return Page(
        items=[track_out(t, liked) for t in tracks], total=total, limit=limit, offset=offset
    )


@router.post("/plays", status_code=status.HTTP_204_NO_CONTENT)
async def record_play(body: PlayIn, session: SessionDep, user: CurrentUser) -> None:
    """Scrobble. Clients should send it once a track was played for ~30s or half its length."""
    await _ensure_track(session, body.track_id)
    session.add(
        PlayEvent(
            user_id=user.id,
            track_id=body.track_id,
            played_at=min(body.played_at or utcnow(), utcnow()),
            listened_ms=body.listened_ms,
        )
    )
    await session.commit()


@router.get("/recent", response_model=list[RecentTrack])
async def recent(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[RecentTrack]:
    """Recently played tracks, each listed once (latest play)."""
    latest = (
        select(PlayEvent.track_id, func.max(PlayEvent.played_at).label("played_at"))
        .where(PlayEvent.user_id == user.id)
        .group_by(PlayEvent.track_id)
        .order_by(func.max(PlayEvent.played_at).desc())
        .limit(limit)
        .subquery()
    )
    rows = (
        await session.execute(
            track_select()
            .add_columns(latest.c.played_at)
            .join(latest, latest.c.track_id == Track.id)
            .order_by(latest.c.played_at.desc())
        )
    ).all()
    liked = set(
        await session.scalars(
            select(TrackLike.track_id).where(
                TrackLike.user_id == user.id, TrackLike.track_id.in_([r[0].id for r in rows])
            )
        )
    )
    return [RecentTrack(played_at=played_at, track=track_out(t, liked)) for t, played_at in rows]
