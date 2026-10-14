import uuid
from datetime import datetime

from fastapi import APIRouter, status
from pydantic import Field
from sqlalchemy import ARRAY, Uuid, any_, func, literal, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.db import utcnow
from app.deps import CurrentUser, SessionDep
from app.errors import ApiError, ErrorCode
from app.library.models import Album, Track
from app.library.queries import TRACK_LOAD, liked_ids, track_out
from app.playlists.models import Playlist, PlaylistItem
from app.schemas import ApiModel, TrackOut

router = APIRouter(prefix="/playlists", tags=["playlists"])


class PlaylistIn(ApiModel):
    name: str = Field(min_length=1, max_length=256)
    description: str | None = Field(default=None, max_length=4000)


class PlaylistPatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=256)
    description: str | None = Field(default=None, max_length=4000)


class PlaylistOut(ApiModel):
    id: uuid.UUID
    name: str
    description: str | None
    track_count: int
    duration_ms: int
    # Up to 4 distinct covers of its tracks for a mosaic thumbnail.
    cover_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime


class PlaylistItemOut(ApiModel):
    item_id: uuid.UUID
    position: int
    added_at: datetime
    track: TrackOut


class PlaylistDetail(PlaylistOut):
    items: list[PlaylistItemOut]


class AddTracksIn(ApiModel):
    track_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)
    # Insert before this position; omitted = append.
    position: int | None = Field(default=None, ge=0)


class MoveIn(ApiModel):
    item_id: uuid.UUID
    position: int = Field(ge=0)


async def _own_playlist(session: AsyncSession, user: User, playlist_id: uuid.UUID) -> Playlist:
    playlist = await session.get(Playlist, playlist_id, with_for_update=True)
    if playlist is None or playlist.owner_id != user.id:
        raise ApiError(ErrorCode.playlist_not_found)
    return playlist


async def _summaries(session: AsyncSession, playlists: list[Playlist]) -> list[PlaylistOut]:
    ids = [p.id for p in playlists]
    if not ids:
        return []
    stats = {
        pid: (count, duration)
        for pid, count, duration in (
            await session.execute(
                select(
                    PlaylistItem.playlist_id,
                    func.count(),
                    func.coalesce(func.sum(Track.duration_ms), 0),
                )
                .join(Track, Track.id == PlaylistItem.track_id)
                .where(PlaylistItem.playlist_id.in_(ids))
                .group_by(PlaylistItem.playlist_id)
            )
        )
    }
    # The tracks' pictures: their own, else their album's.
    cover_id = func.coalesce(Track.cover_id, Album.cover_id)
    first_pos = (
        select(
            PlaylistItem.playlist_id,
            cover_id.label("cover_id"),
            func.min(PlaylistItem.position).label("pos"),
        )
        .join(Track, Track.id == PlaylistItem.track_id)
        .join(Album, Album.id == Track.album_id)
        .where(PlaylistItem.playlist_id.in_(ids), cover_id.is_not(None))
        .group_by(PlaylistItem.playlist_id, cover_id)
        .subquery()
    )
    covers: dict[uuid.UUID, list[uuid.UUID]] = {}
    for pid, cover_id in await session.execute(
        select(first_pos.c.playlist_id, first_pos.c.cover_id).order_by(
            first_pos.c.playlist_id, first_pos.c.pos
        )
    ):
        bucket = covers.setdefault(pid, [])
        if len(bucket) < 4:
            bucket.append(cover_id)
    return [
        PlaylistOut(
            id=p.id,
            name=p.name,
            description=p.description,
            track_count=stats.get(p.id, (0, 0))[0],
            duration_ms=stats.get(p.id, (0, 0))[1],
            cover_ids=covers.get(p.id, []),
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in playlists
    ]


async def _detail(session: AsyncSession, user: User, playlist: Playlist) -> PlaylistDetail:
    items = (
        await session.scalars(
            select(PlaylistItem)
            .where(PlaylistItem.playlist_id == playlist.id)
            .order_by(PlaylistItem.position)
        )
    ).all()
    tracks = {
        t.id: t
        for t in await session.scalars(
            # One array parameter: a long playlist would be more parameters than allowed.
            select(Track)
            .where(Track.id == any_(literal(list({i.track_id for i in items}), ARRAY(Uuid))))
            .options(*TRACK_LOAD)
        )
    }
    liked = await liked_ids(session, user.id, tracks)
    (summary,) = await _summaries(session, [playlist])
    return PlaylistDetail(
        **summary.model_dump(),
        items=[
            PlaylistItemOut(
                item_id=i.id,
                position=i.position,
                added_at=i.added_at,
                track=track_out(tracks[i.track_id], liked),
            )
            for i in items
        ],
    )


async def _renumber(session: AsyncSession, playlist_id: uuid.UUID, ordered: list[uuid.UUID]):
    """Sets each item's position to its index in `ordered`, in a single statement: one
    round trip per item takes seconds for a long playlist on a remote database."""
    if not ordered:
        return
    new_order = (
        func.unnest(literal(ordered, ARRAY(Uuid)))
        .table_valued("item_id", with_ordinality="pos")
        .render_derived()
    )
    await session.execute(
        update(PlaylistItem)
        .where(PlaylistItem.playlist_id == playlist_id, PlaylistItem.id == new_order.c.item_id)
        .values(position=new_order.c.pos - 1)
    )


async def _item_ids(session: AsyncSession, playlist_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        await session.scalars(
            select(PlaylistItem.id)
            .where(PlaylistItem.playlist_id == playlist_id)
            .order_by(PlaylistItem.position)
        )
    )


@router.get("", response_model=list[PlaylistOut])
async def list_playlists(session: SessionDep, user: CurrentUser) -> list[PlaylistOut]:
    playlists = list(
        await session.scalars(
            select(Playlist)
            .where(Playlist.owner_id == user.id)
            .order_by(Playlist.updated_at.desc())
        )
    )
    return await _summaries(session, playlists)


@router.post("", response_model=PlaylistDetail, status_code=status.HTTP_201_CREATED)
async def create_playlist(body: PlaylistIn, session: SessionDep, user: CurrentUser):
    playlist = Playlist(owner_id=user.id, name=body.name, description=body.description)
    session.add(playlist)
    await session.commit()
    return await _detail(session, user, playlist)


@router.get("/{playlist_id}", response_model=PlaylistDetail)
async def get_playlist(playlist_id: uuid.UUID, session: SessionDep, user: CurrentUser):
    playlist = await session.get(Playlist, playlist_id)
    if playlist is None or playlist.owner_id != user.id:
        raise ApiError(ErrorCode.playlist_not_found)
    return await _detail(session, user, playlist)


@router.patch("/{playlist_id}", response_model=PlaylistDetail)
async def update_playlist(
    playlist_id: uuid.UUID, body: PlaylistPatch, session: SessionDep, user: CurrentUser
):
    playlist = await _own_playlist(session, user, playlist_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "name" and value is None:
            continue
        setattr(playlist, field, value)
    playlist.updated_at = utcnow()
    await session.commit()
    return await _detail(session, user, playlist)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playlist(playlist_id: uuid.UUID, session: SessionDep, user: CurrentUser):
    playlist = await _own_playlist(session, user, playlist_id)
    await session.delete(playlist)
    await session.commit()


@router.post("/{playlist_id}/tracks", response_model=PlaylistDetail)
async def add_playlist_tracks(
    playlist_id: uuid.UUID, body: AddTracksIn, session: SessionDep, user: CurrentUser
):
    playlist = await _own_playlist(session, user, playlist_id)
    found = set(await session.scalars(select(Track.id).where(Track.id.in_(body.track_ids))))
    missing = [str(t) for t in body.track_ids if t not in found]
    if missing:
        raise ApiError(ErrorCode.unknown_tracks, f"Unknown tracks: {', '.join(missing)}")

    ordered = await _item_ids(session, playlist.id)
    insert_at = len(ordered) if body.position is None else min(body.position, len(ordered))
    new_items = [
        PlaylistItem(playlist_id=playlist.id, track_id=t, position=0) for t in body.track_ids
    ]
    session.add_all(new_items)
    await session.flush()
    ordered[insert_at:insert_at] = [i.id for i in new_items]
    await _renumber(session, playlist.id, ordered)
    playlist.updated_at = utcnow()
    await session.commit()
    return await _detail(session, user, playlist)


@router.delete("/{playlist_id}/tracks/{item_id}", response_model=PlaylistDetail)
async def remove_playlist_item(
    playlist_id: uuid.UUID, item_id: uuid.UUID, session: SessionDep, user: CurrentUser
):
    playlist = await _own_playlist(session, user, playlist_id)
    item = await session.get(PlaylistItem, item_id)
    if item is None or item.playlist_id != playlist.id:
        raise ApiError(ErrorCode.playlist_item_not_found)
    await session.delete(item)
    await session.flush()
    await _renumber(session, playlist.id, await _item_ids(session, playlist.id))
    playlist.updated_at = utcnow()
    await session.commit()
    return await _detail(session, user, playlist)


@router.post("/{playlist_id}/move", response_model=PlaylistDetail)
async def move_playlist_item(
    playlist_id: uuid.UUID, body: MoveIn, session: SessionDep, user: CurrentUser
):
    playlist = await _own_playlist(session, user, playlist_id)
    ordered = await _item_ids(session, playlist.id)
    if body.item_id not in ordered:
        raise ApiError(ErrorCode.playlist_item_not_found)
    ordered.remove(body.item_id)
    ordered.insert(min(body.position, len(ordered)), body.item_id)
    await _renumber(session, playlist.id, ordered)
    playlist.updated_at = utcnow()
    await session.commit()
    return await _detail(session, user, playlist)
