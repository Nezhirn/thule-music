"""Administration of the library: scans, background jobs, uploads, numbers."""

import asyncio
import enum
import hashlib
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any, BinaryIO

from fastapi import APIRouter, Form, Query, UploadFile, status
from pydantic import ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import AUDIO_EXTENSIONS, Settings
from app.deps import AdminUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode
from app.jobs.models import Job, JobStatus
from app.jobs.queue import enqueue, requeue
from app.library.importer import resolve_in_library
from app.library.models import Album, Artist, Track
from app.library.queries import track_select, tracks_out
from app.library.tags import FOLDER_COVER_SUFFIXES
from app.lyrics.models import SIDECAR_SUFFIXES
from app.schemas import ApiModel, Page, TrackOut

admin_router = APIRouter(prefix="/library", tags=["admin"])

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


class LibraryStats(ApiModel):
    artists: int
    albums: int
    tracks: int
    duration_ms: int
    # Of the audio files as they are in the library (not the transcodes).
    size_bytes: int


class ScanResult(ApiModel):
    """What a scan found, in files. Added and updated ones were queued for import: the
    import goes on after the scan is done (see the job summary)."""

    files: int
    added: int
    updated: int
    moved: int
    removed: int


class JobCounts(ApiModel):
    queued: int = 0
    running: int = 0
    done: int = 0
    failed: int = 0


class ScanOut(ApiModel):
    id: uuid.UUID
    status: JobStatus
    created_at: datetime
    finished_at: datetime | None
    error: str | None
    result: ScanResult | None
    # The imports queued since the scan started (by it, and any uploads meanwhile): its
    # progress once the scan itself is done. Counted with the status, so a scan that reads
    # done always comes with the imports it queued.
    imports: JobCounts


class JobOut(ApiModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    status: JobStatus
    payload: dict[str, Any]
    attempts: int
    max_attempts: int
    error: str | None
    created_at: datetime
    finished_at: datetime | None
    # What the job is about, for people: the file of an import ("Artist/Album/01.mp3"),
    # "Artist — Title" of a track, "Artist — Album" of an album. None for library-wide jobs
    # and for what is gone since.
    subject: str | None = None


class JobSummary(ApiModel):
    # Per job kind: scan_library, import_track, transcode, fetch_lyrics, ...
    kinds: dict[str, JobCounts]
    # Work left over all kinds (queued + running); 0 when the library is up to date.
    pending: int
    failed: int


class RetryResult(ApiModel):
    retried: int


class UploadResult(ApiModel):
    # Where the file is in the library, relative to it.
    path: str
    # The same file (byte for byte) was already in the library: nothing was saved, and
    # `path` is the file that was there.
    duplicate: bool = False


class ImportState(enum.StrEnum):
    queued = "queued"
    importing = "importing"
    imported = "imported"
    failed = "failed"
    # Not in the library and no import pending: deleted, or not found when imported.
    missing = "missing"


class ImportStatusIn(ApiModel):
    paths: list[str] = Field(min_length=1, max_length=100)


class ImportStatus(ApiModel):
    path: str
    state: ImportState
    # Why the import failed; while it waits to be tried again, why the last attempt failed.
    error: str | None
    track: TrackOut | None


async def _scan_out(session: AsyncSession, job: Job) -> ScanOut:
    imports = JobCounts()
    for job_status, count in await session.execute(
        select(Job.status, func.count())
        .where(Job.kind == "import_track", Job.created_at >= job.created_at)
        .group_by(Job.status)
    ):
        setattr(imports, job_status.value, count)
    return ScanOut(
        id=job.id,
        status=job.status,
        created_at=job.created_at,
        finished_at=job.finished_at,
        error=job.error,
        result=ScanResult.model_validate(job.result) if job.result else None,
        imports=imports,
    )


async def _latest_scan(session: AsyncSession) -> Job | None:
    return await session.scalar(
        select(Job).where(Job.kind == "scan_library").order_by(Job.created_at.desc()).limit(1)
    )


@admin_router.get("/stats", response_model=LibraryStats)
async def get_library_stats(session: SessionDep, _: AdminUser) -> LibraryStats:
    tracks, duration, size = (
        await session.execute(
            select(
                func.count(),
                func.coalesce(func.sum(Track.duration_ms), 0),
                func.coalesce(func.sum(Track.size), 0),
            )
        )
    ).one()
    return LibraryStats(
        artists=await session.scalar(select(func.count()).select_from(Artist)) or 0,
        albums=await session.scalar(select(func.count()).select_from(Album)) or 0,
        tracks=tracks,
        duration_ms=duration,
        size_bytes=size,
    )


@admin_router.post("/scan", response_model=ScanOut, status_code=status.HTTP_202_ACCEPTED)
async def start_scan(session: SessionDep, _: AdminUser) -> ScanOut:
    """Queues a scan of the library folder; when one is already waiting or running, that
    one is returned instead."""
    await enqueue(session, "scan_library", dedupe_key="scan")
    await session.commit()
    # The latest whatever its status: a small library may be scanned already.
    job = await _latest_scan(session)
    assert job is not None
    return await _scan_out(session, job)


@admin_router.get("/scan", response_model=ScanOut | None)
async def get_last_scan(session: SessionDep, _: AdminUser) -> ScanOut | None:
    """The latest scan: waiting, running or finished. Null before the first one."""
    job = await _latest_scan(session)
    return await _scan_out(session, job) if job else None


async def _subjects(session: AsyncSession, jobs: list[Job]) -> dict[uuid.UUID, str]:
    def ids(key: str) -> dict[uuid.UUID, uuid.UUID]:
        found = {}
        for job in jobs:
            try:
                found[job.id] = uuid.UUID(str(job.payload[key]))
            except (KeyError, ValueError):
                continue
        return found

    by_track, by_album = ids("track_id"), ids("album_id")
    tracks: dict[uuid.UUID, str] = {}
    if by_track:
        rows = await session.execute(
            select(Track.id, Artist.name, Track.title)
            .join(Artist, Artist.id == Track.artist_id)
            .where(Track.id.in_(set(by_track.values())))
        )
        tracks = {track_id: f"{artist} — {title}" for track_id, artist, title in rows}
    albums: dict[uuid.UUID, str] = {}
    if by_album:
        rows = await session.execute(
            select(Album.id, Artist.name, Album.title)
            .join(Artist, Artist.id == Album.artist_id)
            .where(Album.id.in_(set(by_album.values())))
        )
        albums = {album_id: f"{artist} — {title}" for album_id, artist, title in rows}

    subjects = {}
    for job in jobs:
        if isinstance(path := job.payload.get("path"), str):
            subjects[job.id] = path
        elif job.id in by_track and by_track[job.id] in tracks:
            subjects[job.id] = tracks[by_track[job.id]]
        elif job.id in by_album and by_album[job.id] in albums:
            subjects[job.id] = albums[by_album[job.id]]
    return subjects


@admin_router.get("/jobs", response_model=Page[JobOut])
async def list_jobs(
    session: SessionDep,
    _: AdminUser,
    status_filter: Annotated[JobStatus | None, Query(alias="status")] = None,
    kind: str | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[JobOut]:
    """Newest first."""
    query = select(Job)
    if status_filter is not None:
        query = query.where(Job.status == status_filter)
    if kind is not None:
        query = query.where(Job.kind == kind)
    total = await session.scalar(select(func.count()).select_from(query.subquery())) or 0
    jobs = list(
        await session.scalars(
            query.order_by(Job.created_at.desc(), Job.id).limit(limit).offset(offset)
        )
    )
    subjects = await _subjects(session, jobs)
    items = [
        JobOut.model_validate(job).model_copy(update={"subject": subjects.get(job.id)})
        for job in jobs
    ]
    return Page(items=items, total=total, limit=limit, offset=offset)


@admin_router.get("/jobs/summary", response_model=JobSummary)
async def get_job_summary(
    session: SessionDep, _: AdminUser, since: datetime | None = None
) -> JobSummary:
    """Progress of background work, for a scan/import indicator. `since` counts only jobs
    created after that moment (e.g. when the client started a scan)."""
    query = select(Job.kind, Job.status, func.count()).group_by(Job.kind, Job.status)
    if since is not None:
        query = query.where(Job.created_at >= since)
    kinds: dict[str, JobCounts] = {}
    for kind, job_status, count in await session.execute(query):
        setattr(kinds.setdefault(kind, JobCounts()), job_status.value, count)
    return JobSummary(
        kinds=kinds,
        pending=sum(c.queued + c.running for c in kinds.values()),
        failed=sum(c.failed for c in kinds.values()),
    )


@admin_router.post("/jobs/retry", response_model=RetryResult)
async def retry_failed_jobs(session: SessionDep, _: AdminUser) -> RetryResult:
    """Runs every failed job again, from its first attempt."""
    failed = list(
        await session.scalars(
            select(Job).where(Job.status == JobStatus.failed).order_by(Job.created_at.desc())
        )
    )
    await requeue(session, failed)
    await session.commit()
    return RetryResult(retried=len(failed))


@admin_router.post("/jobs/{job_id}/retry", status_code=status.HTTP_204_NO_CONTENT)
async def retry_job(job_id: uuid.UUID, session: SessionDep, _: AdminUser) -> None:
    """Runs a failed job again, from its first attempt. The failed one is replaced."""
    job = await session.scalar(select(Job).where(Job.id == job_id, Job.status == JobStatus.failed))
    if job is None:
        raise ApiError(ErrorCode.job_not_found)
    await requeue(session, [job])
    await session.commit()


@admin_router.delete("/jobs/failed", status_code=status.HTTP_204_NO_CONTENT)
async def clear_failed_jobs(session: SessionDep, _: AdminUser) -> None:
    """Forgets the failed jobs (they would be cleaned up after 30 days anyway)."""
    await session.execute(delete(Job).where(Job.status == JobStatus.failed))
    await session.commit()


# --- uploads -------------------------------------------------------------------------------

_UNSAFE = re.compile(r"[^\w\-. ()\[\]&,']+", re.UNICODE)
# Besides audio: what a scan uses from an album's folder.
UPLOAD_EXTENSIONS = AUDIO_EXTENSIONS | set(FOLDER_COVER_SUFFIXES) | set(SIDECAR_SUFFIXES)
MAX_NAME = 120  # characters of a file or folder name: Cyrillic takes 2 of the 255 bytes
MAX_DEPTH = 8


def _safe_part(name: str) -> str:
    """A file or folder name with nothing that could reach outside its folder ("..", "/")
    or hide it (a leading dot); "" when nothing is left."""
    cleaned = _UNSAFE.sub("_", name).strip(" .")
    if len(cleaned) > MAX_NAME:
        stem, suffix = Path(cleaned).stem, Path(cleaned).suffix
        cleaned = stem[: MAX_NAME - len(suffix)].rstrip(" .") + suffix
    return cleaned


def _safe_name(name: str) -> str:
    return _safe_part(Path(name).name) or "upload"


def _safe_folder(folder: str) -> Path:
    parts = [part for raw in folder.replace("\\", "/").split("/") if (part := _safe_part(raw))]
    return Path(*parts[:MAX_DEPTH])


def _save_upload(src: BinaryIO, directory: Path, name: str) -> tuple[Path, str]:
    """Copies an upload to the first free name: "x.mp3", "x (1).mp3", ... Never overwrites:
    the name is claimed with an exclusive create, so concurrent uploads can't collide.
    Returns the file and the SHA-256 of its content."""
    stem, suffix = Path(name).stem, Path(name).suffix
    dest, n = directory / name, 1
    while True:
        try:
            out = dest.open("xb")
        except FileExistsError:
            dest = directory / f"{stem} ({n}){suffix}"
            n += 1
            continue
        digest = hashlib.sha256()
        try:
            with out:
                while chunk := src.read(1024 * 1024):
                    digest.update(chunk)
                    out.write(chunk)
        except BaseException:
            dest.unlink(missing_ok=True)
            raise
        return dest, digest.hexdigest()


def _sha256(path: Path) -> str | None:
    try:
        with path.open("rb") as fh:
            return hashlib.file_digest(fh, "sha256").hexdigest()
    except OSError:
        return None


def _same_size_files(directory: Path, size: int, saved: Path) -> list[str]:
    """Names of the other files of this size beside the one just saved: an earlier upload
    of the same folder, maybe not imported yet, so not a track yet."""
    try:
        entries = list(os.scandir(directory))
    except OSError:
        return []
    return [
        entry.name
        for entry in entries
        if entry.is_file() and entry.name != saved.name and entry.stat().st_size == size
    ]


async def _existing_copy(
    session: AsyncSession, settings: Settings, saved: Path, digest: str
) -> str | None:
    """Path (in the library) of a file with the same content as the one just saved: a track
    anywhere, or any file beside it."""
    size = (await asyncio.to_thread(saved.stat)).st_size
    candidates: list[str] = []
    if _is_audio(saved.name):
        candidates += await session.scalars(select(Track.path).where(Track.size == size).limit(20))
    folder = saved.parent.relative_to(settings.library_path)
    candidates += [
        (folder / name).as_posix()
        for name in await asyncio.to_thread(_same_size_files, saved.parent, size, saved)
    ]
    for rel in dict.fromkeys(candidates):
        full = resolve_in_library(settings.library_path, rel)
        if await asyncio.to_thread(_sha256, full) == digest:
            return rel
    return None


def _is_audio(name: str) -> bool:
    return Path(name).suffix.casefold() in AUDIO_EXTENSIONS


@admin_router.post(
    "/uploads", response_model=list[UploadResult], status_code=status.HTTP_202_ACCEPTED
)
async def upload_files(
    files: list[UploadFile],
    session: SessionDep,
    settings: SettingsDep,
    _: AdminUser,
    folder: Annotated[str, Form(max_length=1024)] = "",
) -> list[UploadResult]:
    """Saves files into `<library>/uploads/<folder>/` and queues the audio ones for import.
    Besides audio, an album's cover image (cover.jpg, folder.png, ...) and lyrics files
    (.lrc, .txt) are taken: `folder` keeps an album's files together, e.g. "Artist/Album"
    for a dropped album folder. A file already in the library byte for byte is not saved
    again. Results are in the order of the files."""
    names = [_safe_name(file.filename or "upload") for file in files]
    # Validate the whole batch first so a rejected request leaves nothing on disk.
    for file, name in zip(files, names, strict=True):
        if Path(name).suffix.casefold() not in UPLOAD_EXTENSIONS:
            raise ApiError(ErrorCode.not_an_audio_file, f"Can't upload {file.filename}")
    directory = settings.uploads_path / _safe_folder(folder)
    await asyncio.to_thread(directory.mkdir, parents=True, exist_ok=True)
    results = []
    for file, name in zip(files, names, strict=True):
        dest, digest = await asyncio.to_thread(_save_upload, file.file, directory, name)
        existing = await _existing_copy(session, settings, dest, digest)
        if existing is not None:
            await asyncio.to_thread(dest.unlink)
            results.append(UploadResult(path=existing, duplicate=True))
            continue
        rel = dest.relative_to(settings.library_path).as_posix()
        if _is_audio(name):
            await enqueue(session, "import_track", {"path": rel}, dedupe_key=f"import:{rel}")
        results.append(UploadResult(path=rel))
    await session.commit()
    return results


@admin_router.post("/uploads/status", response_model=list[ImportStatus])
async def get_import_status(
    body: ImportStatusIn, session: SessionDep, admin: AdminUser
) -> list[ImportStatus]:
    """How the import of each file is going (files as `upload_files` returned them), in
    the order asked. A POST only so that many long paths fit."""
    tracks = {
        track.path: track
        for track in await session.scalars(track_select().where(Track.path.in_(body.paths)))
    }
    out = dict(zip(tracks, await tracks_out(session, admin.id, list(tracks.values())), strict=True))
    keys = [f"import:{path}" for path in body.paths]
    jobs: dict[str | None, Job] = {
        job.dedupe_key: job
        for job in await session.scalars(
            select(Job)
            .where(Job.dedupe_key.in_(keys))
            .ext(distinct_on(Job.dedupe_key))
            .order_by(Job.dedupe_key, Job.created_at.desc())
        )
    }
    statuses = []
    for path in body.paths:
        job = jobs.get(f"import:{path}")
        track = out.get(path)
        if job is not None and job.status == JobStatus.queued:
            state = ImportState.queued
        elif job is not None and job.status == JobStatus.running:
            state = ImportState.importing
        elif track is not None:
            state = ImportState.imported
        elif job is not None and job.status == JobStatus.failed:
            state = ImportState.failed
        else:
            state = ImportState.missing
        error = job.error if job is not None and state != ImportState.imported else None
        statuses.append(ImportStatus(path=path, state=state, error=error, track=track))
    return statuses
