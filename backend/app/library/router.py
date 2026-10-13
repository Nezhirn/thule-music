import asyncio
import enum
import re
import shutil
import uuid
from pathlib import Path
from typing import Annotated, BinaryIO

from fastapi import APIRouter, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.config import AUDIO_EXTENSIONS
from app.deps import AdminUser, CurrentUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode
from app.jobs.models import Job, JobStatus
from app.jobs.queue import enqueue
from app.library.models import Album, Artist, Track
from app.library.queries import (
    ALBUM_LOAD,
    TRACK_ORDER,
    album_out,
    artists_out,
    contains,
    track_select,
    tracks_out,
)
from app.me.models import PlayEvent
from app.schemas import AlbumDetail, AlbumOut, ArtistDetail, ArtistOut, Page, TrackOut

router = APIRouter(tags=["library"])
admin_router = APIRouter(prefix="/library", tags=["admin"])

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


class AlbumSort(enum.StrEnum):
    by_added = "added"
    by_title = "title"
    by_year = "year"


@router.get("/artists", response_model=Page[ArtistOut])
async def list_artists(
    session: SessionDep,
    _: CurrentUser,
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
    return Page(items=await artists_out(session, artists), total=total, limit=limit, offset=offset)


@router.get("/artists/{artist_id}", response_model=ArtistDetail)
async def get_artist(artist_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> ArtistDetail:
    artist = await session.get(Artist, artist_id)
    if artist is None:
        raise ApiError(ErrorCode.artist_not_found)
    albums = (
        await session.scalars(
            select(Album)
            .where(Album.artist_id == artist_id)
            .options(*ALBUM_LOAD)
            .order_by(Album.year.desc().nulls_last(), Album.title_key)
        )
    ).all()

    plays = (
        select(PlayEvent.track_id, func.count().label("n")).group_by(PlayEvent.track_id).subquery()
    )
    top = (
        await session.scalars(
            track_select()
            .outerjoin(plays, plays.c.track_id == Track.id)
            .where(Track.artist_id == artist_id)
            .order_by(func.coalesce(plays.c.n, 0).desc(), *TRACK_ORDER)
            .limit(10)
        )
    ).all()

    (base,) = await artists_out(session, [artist])
    return ArtistDetail(
        **base.model_dump(),
        albums=[album_out(a) for a in albums],
        top_tracks=await tracks_out(session, user.id, top),
    )


@router.get("/albums", response_model=Page[AlbumOut])
async def list_albums(
    session: SessionDep,
    _: CurrentUser,
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
    order = {
        AlbumSort.by_added: (Album.added_at.desc(), Album.id),
        AlbumSort.by_title: (Album.title_key, Album.id),
        AlbumSort.by_year: (Album.year.desc().nulls_last(), Album.title_key),
    }[sort]
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    albums = (
        await session.scalars(
            query.options(*ALBUM_LOAD).order_by(*order).limit(limit).offset(offset)
        )
    ).all()
    return Page(items=[album_out(a) for a in albums], total=total, limit=limit, offset=offset)


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
        **album_out(album).model_dump(),
        duration_ms=sum(t.duration_ms for t in tracks),
        tracks=await tracks_out(session, user.id, tracks),
    )


@router.get("/tracks", response_model=Page[TrackOut])
async def list_tracks(
    session: SessionDep,
    user: CurrentUser,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[TrackOut]:
    total = await session.scalar(select(func.count()).select_from(Track)) or 0
    tracks = (
        await session.scalars(
            track_select().order_by(Track.added_at.desc(), Track.id).limit(limit).offset(offset)
        )
    ).all()
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


# --- admin -----------------------------------------------------------------------------


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    status: JobStatus
    payload: dict
    attempts: int
    error: str | None


class UploadResult(BaseModel):
    path: str


@admin_router.post("/scan", status_code=status.HTTP_202_ACCEPTED)
async def start_scan(session: SessionDep, _: AdminUser) -> dict[str, str]:
    await enqueue(session, "scan_library", dedupe_key="scan")
    await session.commit()
    return {"status": "queued"}


_UNSAFE = re.compile(r"[^\w\-. ()\[\]&,']+", re.UNICODE)


def _safe_name(name: str) -> str:
    cleaned = _UNSAFE.sub("_", Path(name).name).strip(" .")
    return cleaned or "upload"


def _save_upload(src: BinaryIO, directory: Path, name: str) -> Path:
    """Copies an upload to the first free name: "x.mp3", "x (1).mp3", ... Never overwrites:
    the name is claimed with an exclusive create, so concurrent uploads can't collide."""
    stem, suffix = Path(name).stem, Path(name).suffix
    dest, n = directory / name, 1
    while True:
        try:
            out = dest.open("xb")
        except FileExistsError:
            dest = directory / f"{stem} ({n}){suffix}"
            n += 1
            continue
        try:
            with out:
                shutil.copyfileobj(src, out, 1024 * 1024)
        except BaseException:
            dest.unlink(missing_ok=True)
            raise
        return dest


@admin_router.post(
    "/uploads", response_model=list[UploadResult], status_code=status.HTTP_202_ACCEPTED
)
async def upload_files(
    files: list[UploadFile], session: SessionDep, settings: SettingsDep, _: AdminUser
) -> list[UploadResult]:
    """Saves audio files into `<library>/uploads/` and queues them for import."""
    names = [_safe_name(file.filename or "upload") for file in files]
    # Validate the whole batch first so a rejected request leaves nothing on disk.
    for file, name in zip(files, names, strict=True):
        if Path(name).suffix.casefold() not in AUDIO_EXTENSIONS:
            raise ApiError(ErrorCode.not_an_audio_file, f"Not an audio file: {file.filename}")
    settings.uploads_path.mkdir(parents=True, exist_ok=True)
    results = []
    for file, name in zip(files, names, strict=True):
        dest = await asyncio.to_thread(_save_upload, file.file, settings.uploads_path, name)
        rel = dest.relative_to(settings.library_path).as_posix()
        await enqueue(session, "import_track", {"path": rel}, dedupe_key=f"import:{rel}")
        results.append(UploadResult(path=rel))
    await session.commit()
    return results


@admin_router.get("/jobs", response_model=list[JobOut])
async def list_jobs(
    session: SessionDep,
    _: AdminUser,
    status_filter: Annotated[JobStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
) -> list[Job]:
    query = select(Job).order_by(Job.created_at.desc()).limit(limit)
    if status_filter is not None:
        query = query.where(Job.status == status_filter)
    return list(await session.scalars(query))
