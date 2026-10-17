import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Query, status
from pydantic import Field, field_validator
from sqlalchemy import ARRAY, Text, delete, func, literal, select, tuple_, update
from sqlalchemy.dialects.postgresql import JSONB, insert

from app.auth.models import User
from app.db import utcnow
from app.deps import CurrentUser, SessionDep
from app.errors import ApiError, ErrorCode
from app.library.filters import (
    Filters,
    GenreParam,
    album_filters,
    artist_filters,
    track_filters,
)
from app.library.models import Album, Artist, Track
from app.library.queries import (
    ALBUM_LOAD,
    TRACK_LOAD,
    album_out,
    artists_out,
    liked_ids,
    track_out,
    track_select,
)
from app.me.models import AlbumLike, ArtistLike, PlayEvent, TrackLike
from app.me.preferences import Preferences, PreferencesPatch, load_preferences
from app.schemas import AlbumOut, ApiModel, ArtistOut, Page, TrackOut

router = APIRouter(prefix="/me", tags=["me"])


# "Recently played" looks among this many latest plays.
RECENT_PLAYS = 2000


class PlayIn(ApiModel):
    track_id: uuid.UUID
    # When the track was played (a play sent later, after being offline). Without a time zone
    # it is taken as UTC.
    played_at: datetime | None = None
    listened_ms: int | None = Field(default=None, ge=0, le=2**31 - 1)

    @field_validator("played_at")
    @classmethod
    def _utc(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


class RecentTrack(ApiModel):
    played_at: datetime
    track: TrackOut


class Play(ApiModel):
    id: uuid.UUID
    played_at: datetime
    track: TrackOut


class History(ApiModel):
    items: list[Play]
    # The `before` of the next, older page; None after the oldest play.
    next: uuid.UUID | None


async def _ensure_track(session, track_id: uuid.UUID) -> None:
    if await session.get(Track, track_id) is None:
        raise ApiError(ErrorCode.track_not_found)


@router.put("/likes/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def like_track(track_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await _ensure_track(session, track_id)
    await session.execute(
        insert(TrackLike).values(user_id=user.id, track_id=track_id).on_conflict_do_nothing()
    )
    await session.commit()


@router.delete("/likes/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_track(track_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await session.execute(
        delete(TrackLike).where(TrackLike.user_id == user.id, TrackLike.track_id == track_id)
    )
    await session.commit()


@router.get("/likes/tracks", response_model=Page[TrackOut])
async def list_liked_tracks(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    artist_id: uuid.UUID | None = None,
    album_id: uuid.UUID | None = None,
    genre: GenreParam = None,
) -> Page[TrackOut]:
    """The virtual "Liked Music" playlist, newest first; filtered as GET /tracks is."""
    where = [
        TrackLike.user_id == user.id,
        *track_filters(Filters(artist_id=artist_id, album_id=album_id, genre=genre)),
    ]
    total = (
        await session.scalar(
            select(func.count())
            .select_from(TrackLike)
            .join(Track, Track.id == TrackLike.track_id)
            .where(*where)
        )
        or 0
    )
    tracks = (
        await session.scalars(
            track_select()
            .join(TrackLike, TrackLike.track_id == Track.id)
            .where(*where)
            .order_by(TrackLike.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    liked = {t.id for t in tracks}
    return Page(
        items=[track_out(t, liked) for t in tracks], total=total, limit=limit, offset=offset
    )


@router.put("/likes/albums/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
async def like_album(album_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    if await session.get(Album, album_id) is None:
        raise ApiError(ErrorCode.album_not_found)
    await session.execute(
        insert(AlbumLike).values(user_id=user.id, album_id=album_id).on_conflict_do_nothing()
    )
    await session.commit()


@router.delete("/likes/albums/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_album(album_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await session.execute(
        delete(AlbumLike).where(AlbumLike.user_id == user.id, AlbumLike.album_id == album_id)
    )
    await session.commit()


@router.get("/likes/albums", response_model=Page[AlbumOut])
async def list_liked_albums(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    artist_id: uuid.UUID | None = None,
    genre: GenreParam = None,
) -> Page[AlbumOut]:
    """Saved albums, newest first; filtered as GET /albums is."""
    where = [
        AlbumLike.user_id == user.id,
        *album_filters(Filters(artist_id=artist_id, genre=genre)),
    ]
    total = await session.scalar(
        select(func.count())
        .select_from(AlbumLike)
        .join(Album, Album.id == AlbumLike.album_id)
        .where(*where)
    )
    albums = (
        await session.scalars(
            select(Album)
            .join(AlbumLike, AlbumLike.album_id == Album.id)
            .where(*where)
            .options(*ALBUM_LOAD)
            .order_by(AlbumLike.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    liked = {a.id for a in albums}
    return Page(
        items=[album_out(a, liked) for a in albums], total=total or 0, limit=limit, offset=offset
    )


@router.put("/likes/artists/{artist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def like_artist(artist_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    if await session.get(Artist, artist_id) is None:
        raise ApiError(ErrorCode.artist_not_found)
    await session.execute(
        insert(ArtistLike).values(user_id=user.id, artist_id=artist_id).on_conflict_do_nothing()
    )
    await session.commit()


@router.delete("/likes/artists/{artist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_artist(artist_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> None:
    await session.execute(
        delete(ArtistLike).where(ArtistLike.user_id == user.id, ArtistLike.artist_id == artist_id)
    )
    await session.commit()


@router.get("/likes/artists", response_model=Page[ArtistOut])
async def list_liked_artists(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    genre: GenreParam = None,
) -> Page[ArtistOut]:
    """Followed artists, newest first; filtered as GET /artists is."""
    where = [ArtistLike.user_id == user.id, *artist_filters(Filters(genre=genre))]
    total = await session.scalar(
        select(func.count())
        .select_from(ArtistLike)
        .join(Artist, Artist.id == ArtistLike.artist_id)
        .where(*where)
    )
    artists = (
        await session.scalars(
            select(Artist)
            .join(ArtistLike, ArtistLike.artist_id == Artist.id)
            .where(*where)
            .order_by(ArtistLike.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return Page(
        items=await artists_out(session, user.id, artists),
        total=total or 0,
        limit=limit,
        offset=offset,
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
async def list_recent_tracks(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> list[RecentTrack]:
    """Recently played tracks, each listed once (latest play)."""
    # Among the latest plays only, read newest first along the index: the whole history
    # grows for ever.
    plays = (
        select(PlayEvent.track_id, PlayEvent.played_at)
        .where(PlayEvent.user_id == user.id)
        .order_by(PlayEvent.played_at.desc())
        .limit(RECENT_PLAYS)
        .subquery()
    )
    latest = (
        select(plays.c.track_id, func.max(plays.c.played_at).label("played_at"))
        .group_by(plays.c.track_id)
        .order_by(func.max(plays.c.played_at).desc())
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


@router.get("/history", response_model=History)
async def list_history(
    session: SessionDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before: uuid.UUID | None = None,
) -> History:
    """Every play, newest first. Paged by the last play of the previous page (`before`), so
    plays recorded while the list is read don't shift the pages."""
    query = select(PlayEvent).where(PlayEvent.user_id == user.id)
    if before is not None:
        anchor = await session.get(PlayEvent, before)
        if anchor is None or anchor.user_id != user.id:
            # Cleared meanwhile (another device): nothing older to show.
            return History(items=[], next=None)
        query = query.where(
            tuple_(PlayEvent.played_at, PlayEvent.id) < tuple_(anchor.played_at, anchor.id)
        )
    plays = (
        await session.scalars(
            query.order_by(PlayEvent.played_at.desc(), PlayEvent.id.desc()).limit(limit + 1)
        )
    ).all()
    more = len(plays) > limit
    plays = plays[:limit]
    tracks = {
        t.id: t
        for t in await session.scalars(
            select(Track).where(Track.id.in_({p.track_id for p in plays})).options(*TRACK_LOAD)
        )
    }
    liked = await liked_ids(session, user.id, tracks)
    return History(
        items=[
            Play(id=p.id, played_at=p.played_at, track=track_out(tracks[p.track_id], liked))
            for p in plays
        ],
        next=plays[-1].id if more else None,
    )


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
async def clear_history(session: SessionDep, user: CurrentUser) -> None:
    """Forgets every play: history, "Recently played", and what "For you" learnt from them."""
    await session.execute(delete(PlayEvent).where(PlayEvent.user_id == user.id))
    await session.commit()


@router.get("/preferences", response_model=Preferences)
async def get_preferences(user: CurrentUser) -> Preferences:
    return load_preferences(user.preferences)


@router.patch("/preferences", response_model=Preferences)
async def update_preferences(
    body: PreferencesPatch, session: SessionDep, user: CurrentUser
) -> Preferences:
    changes = body.model_dump(mode="json", exclude_unset=True)
    values = {key: value for key, value in changes.items() if value is not None}
    resets = [key for key, value in changes.items() if value is None]
    # Merged in SQL: two devices changing different settings at once both keep their change.
    merged = User.preferences.op("||", return_type=JSONB)(literal(values, JSONB)).op(
        "-", return_type=JSONB
    )(literal(resets, ARRAY(Text)))
    stored = await session.scalar(
        update(User)
        .where(User.id == user.id)
        .values(preferences=merged)
        .returning(User.preferences)
    )
    await session.commit()
    return load_preferences(stored or {})
