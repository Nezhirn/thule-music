"""Library scanning and per-file import (runs inside the job worker)."""

import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import delete, exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import AUDIO_EXTENSIONS
from app.jobs.context import JobContext
from app.jobs.queue import enqueue
from app.library.covers import store_cover
from app.library.models import Album, Artist, Track, name_key
from app.library.tags import folder_cover, read_tags

log = logging.getLogger(__name__)


def resolve_in_library(library_root: Path, rel_path: str) -> Path:
    """Maps a stored relative path to an absolute one, refusing anything outside the root."""
    root = library_root.resolve()
    full = (root / rel_path).resolve()
    if not full.is_relative_to(root):
        raise ValueError(f"Path escapes library root: {rel_path}")
    return full


def _walk(root: Path) -> dict[str, tuple[int, float]]:
    found: dict[str, tuple[int, float]] = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if name.startswith(".") or Path(name).suffix.casefold() not in AUDIO_EXTENSIONS:
                continue
            full = Path(dirpath, name)
            try:
                st = full.stat()
            except OSError:
                continue
            found[full.relative_to(root).as_posix()] = (st.st_size, st.st_mtime)
    return found


async def delete_orphans(session: AsyncSession) -> None:
    await session.execute(delete(Album).where(~exists().where(Track.album_id == Album.id)))
    await session.execute(
        delete(Artist).where(
            ~exists().where(Track.artist_id == Artist.id),
            ~exists().where(Album.artist_id == Artist.id),
        )
    )


async def scan_library(ctx: JobContext, payload: dict[str, Any]) -> None:
    root = ctx.settings.library_path
    if not root.is_dir():
        raise FileNotFoundError(f"Library path does not exist: {root}")
    on_disk = await asyncio.to_thread(_walk, root.resolve())

    async with ctx.sessionmaker() as session:
        known = {
            row.path: (row.size, row.mtime)
            for row in await session.execute(select(Track.path, Track.size, Track.mtime))
        }
        changed = [p for p, stat in on_disk.items() if known.get(p) != stat]
        removed = [p for p in known if p not in on_disk]

        for rel in changed:
            await enqueue(session, "import_track", {"path": rel}, dedupe_key=f"import:{rel}")
        if removed:
            await session.execute(delete(Track).where(Track.path.in_(removed)))
            await delete_orphans(session)
        await session.commit()
    log.info("scan: %d files, %d to import, %d removed", len(on_disk), len(changed), len(removed))


async def _upsert_artist(session: AsyncSession, name: str) -> uuid.UUID:
    key = name_key(name)
    await session.execute(
        insert(Artist).values(id=uuid.uuid4(), name=name, name_key=key).on_conflict_do_nothing()
    )
    artist_id = await session.scalar(select(Artist.id).where(Artist.name_key == key))
    assert artist_id is not None
    return artist_id


async def _upsert_album(
    session: AsyncSession, title: str, artist_id: uuid.UUID, year: int | None, genre: str | None
) -> Album:
    key = name_key(title)
    await session.execute(
        insert(Album)
        .values(
            id=uuid.uuid4(), title=title, title_key=key, artist_id=artist_id, year=year, genre=genre
        )
        .on_conflict_do_nothing(constraint="uq_albums_artist_title")
    )
    album = await session.scalar(
        select(Album).where(Album.artist_id == artist_id, Album.title_key == key)
    )
    assert album is not None
    if album.year is None and year is not None:
        album.year = year
    if album.genre is None and genre is not None:
        album.genre = genre
    return album


async def import_track(ctx: JobContext, payload: dict[str, Any]) -> None:
    rel: str = payload["path"]
    full = resolve_in_library(ctx.settings.library_path, rel)

    async with ctx.sessionmaker() as session:
        if not full.is_file():
            await session.execute(delete(Track).where(Track.path == rel))
            await delete_orphans(session)
            await session.commit()
            return

        st = full.stat()
        tags = await asyncio.to_thread(read_tags, full)

        album_artist_id = await _upsert_artist(session, tags.album_artist)
        track_artist_id = (
            album_artist_id
            if name_key(tags.artist) == name_key(tags.album_artist)
            else await _upsert_artist(session, tags.artist)
        )
        album = await _upsert_album(session, tags.album, album_artist_id, tags.year, tags.genre)

        if album.cover_id is None:
            picture = tags.picture
            if picture is None and (cover_path := folder_cover(full.parent)) is not None:
                picture = await asyncio.to_thread(cover_path.read_bytes)
            if picture is not None:
                cover = await store_cover(session, ctx.settings.covers_path, picture)
                if cover is not None:
                    album.cover_id = cover.id

        track = await session.scalar(select(Track).where(Track.path == rel))
        if track is None:
            track = Track(path=rel)
            session.add(track)
        track.title = tags.title
        track.album_id = album.id
        track.artist_id = track_artist_id
        track.disc_no = tags.disc_no
        track.track_no = tags.track_no
        track.duration_ms = tags.duration_ms
        track.size = st.st_size
        track.mtime = st.st_mtime
        track.codec = tags.codec
        track.bitrate = tags.bitrate
        track.sample_rate = tags.sample_rate
        await session.flush()

        # A re-import may move the track to another album; drop what that left empty.
        await delete_orphans(session)

        track_id = str(track.id)
        await enqueue(
            session, "transcode", {"track_id": track_id}, dedupe_key=f"transcode:{track_id}"
        )
        await enqueue(
            session,
            "fetch_lyrics",
            {"track_id": track_id, "embedded": tags.lyrics},
            dedupe_key=f"lyrics:{track_id}",
        )
        await session.commit()
