"""Library scanning and per-file import (runs inside the job worker)."""

import asyncio
import contextlib
import logging
import os
import posixpath
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from sqlalchemy import ARRAY, String, Uuid, any_, delete, exists, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import AUDIO_EXTENSIONS
from app.jobs.context import JobContext
from app.jobs.queue import enqueue, enqueue_many
from app.library.covers import is_image, store_cover
from app.library.models import Album, Artist, Cover, Track, name_key
from app.library.queries import TRACK_ORDER
from app.library.tags import embedded_picture, folder_cover, pick_folder_cover, read_tags

log = logging.getLogger(__name__)


def resolve_in_library(library_root: Path, rel_path: str) -> Path:
    """Maps a stored relative path to an absolute one. Refuses absolute paths and `..`, but
    does not resolve symlinks: the scanner includes symlinked folders on purpose, and their
    files live outside the root."""
    rel = PurePosixPath(rel_path)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError(f"Path escapes library root: {rel_path}")
    return library_root.resolve() / rel


Stat = tuple[int, float]

# Album art is looked for in an album's first tracks only (their folders and embedded
# artwork): a big album without any, such as "Unknown Album", would otherwise make each
# import of one of its tracks read all of them.
ART_TRACKS = 10


def _walk(root: Path) -> tuple[dict[str, Stat], dict[str, tuple[str, float]]]:
    """Audio files as {path: (size, mtime)}, and the album art image of each folder that has
    one as {folder: (image path, mtime)}; paths relative to the root, the root folder is ""."""
    found: dict[str, Stat] = {}
    images: dict[str, tuple[str, float]] = {}
    # (st_dev, st_ino) of the directories from the root down to each visited one. Symlinks
    # are followed, so a link back to an ancestor would otherwise repeat the subtree.
    ancestry: dict[str, frozenset[tuple[int, int]]] = {}
    for dirpath, dirnames, filenames in os.walk(root, followlinks=True):
        try:
            dir_st = os.stat(dirpath)
        except OSError:
            dirnames[:] = []
            continue
        dir_id = (dir_st.st_dev, dir_st.st_ino)
        above = ancestry.get(os.path.dirname(dirpath), frozenset())
        if dir_id in above:
            dirnames[:] = []
            continue
        ancestry[dirpath] = above | {dir_id}
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        rel_dir = Path(dirpath).relative_to(root).as_posix().removeprefix(".")
        if image := pick_folder_cover(n for n in filenames if not n.startswith(".")):
            with contextlib.suppress(OSError):
                mtime = os.stat(Path(dirpath, image)).st_mtime
                images[rel_dir] = (posixpath.join(rel_dir, image), mtime)
        for name in filenames:
            if name.startswith(".") or Path(name).suffix.casefold() not in AUDIO_EXTENSIONS:
                continue
            full = Path(dirpath, name)
            try:
                st = full.stat()
            except OSError:
                continue
            found[full.relative_to(root).as_posix()] = (st.st_size, st.st_mtime)
    return found, images


def _album_picture(root: Path, paths: list[str]) -> tuple[bytes, str, float] | None:
    """An album's art, from its first tracks' paths in track order: the first folder image
    (cover.jpg, folder.png, ...), else the first embedded artwork.
    Returns (image bytes, the library path it came from, that file's mtime)."""
    folders = list(dict.fromkeys(posixpath.dirname(rel) for rel in paths))
    for folder in folders:
        image = folder_cover(resolve_in_library(root, folder or "."))
        if image is None:
            continue
        try:
            data, mtime = image.read_bytes(), image.stat().st_mtime
        except OSError:
            continue
        if is_image(data):
            return data, posixpath.join(folder, image.name), mtime
    for rel in paths:
        full = resolve_in_library(root, rel)
        try:
            picture, mtime = embedded_picture(full), full.stat().st_mtime
        except Exception:
            continue  # unreadable file: its own import reports it
        if picture is not None and is_image(picture):
            return picture, rel, mtime
    return None


async def choose_album_cover(
    session: AsyncSession, library: Path, covers: Path, album: Album
) -> None:
    """Sets the album's cover from its current tracks (see _album_picture). Runs on every
    import of one of its tracks, and when a scan sees one of its folder images change."""
    paths = list(
        await session.scalars(
            select(Track.path)
            .where(Track.album_id == album.id)
            .order_by(*TRACK_ORDER, Track.path)
            .limit(ART_TRACKS)
        )
    )
    found = await asyncio.to_thread(_album_picture, library, paths)
    cover = await store_cover(session, covers, found[0]) if found else None
    if found and cover:
        album.cover_id, album.cover_source, album.cover_mtime = cover.id, found[1], found[2]
    else:
        album.cover_id = album.cover_source = album.cover_mtime = None


def _stale_covers(
    albums: list[tuple[uuid.UUID, str | None, float | None]],
    folders: dict[uuid.UUID, set[str]],
    images: dict[str, tuple[str, float]],
) -> list[uuid.UUID]:
    """Albums whose art must be chosen again: a folder image appeared, changed or vanished."""
    stale = []
    for album_id, source, mtime in albums:
        present = {images[f] for f in folders.get(album_id, ()) if f in images}
        if present:
            if (source, mtime) not in present:
                stale.append(album_id)
        elif source is not None and PurePosixPath(source).suffix.casefold() not in AUDIO_EXTENSIONS:
            stale.append(album_id)
    return stale


async def refresh_album_cover(ctx: JobContext, payload: dict[str, Any]) -> None:
    """Job `album_cover`."""
    async with ctx.sessionmaker() as session:
        album = await session.get(Album, uuid.UUID(payload["album_id"]))
        if album is None:
            return
        await choose_album_cover(
            session, ctx.settings.library_path, ctx.settings.covers_path, album
        )
        await session.commit()


async def delete_orphans(session: AsyncSession) -> None:
    await session.execute(delete(Album).where(~exists().where(Track.album_id == Album.id)))
    await session.execute(
        delete(Artist).where(
            ~exists().where(Track.artist_id == Artist.id),
            ~exists().where(Album.artist_id == Artist.id),
        )
    )


# Same tags but a duration further off than this: a different recording, not a moved file.
MOVE_DURATION_TOLERANCE_MS = 2000

Identity = tuple[str, str, int | None, int | None, str]


@dataclass(frozen=True)
class _Known:
    id: uuid.UUID
    size: int
    mtime: float


def _identity(
    album_artist: str, album: str, disc_no: int | None, track_no: int | None, title: str
) -> Identity:
    return (name_key(album_artist), name_key(album), disc_no, track_no, name_key(title))


def _read_identities(root: Path, paths: list[str]) -> dict[str, tuple[Identity, int]]:
    found = {}
    for rel in paths:
        try:
            tags = read_tags(root / rel, lyrics=False)
        except Exception:
            continue  # unreadable files are reported by their own import job
        ident = _identity(tags.album_artist, tags.album, tags.disc_no, tags.track_no, tags.title)
        found[rel] = (ident, tags.duration_ms)
    return found


def _one_to_one(proposals: list[tuple[str, uuid.UUID]]) -> dict[str, uuid.UUID]:
    """Keeps the pairs in which neither the path nor the track was proposed twice."""
    paths = Counter(path for path, _ in proposals)
    tracks = Counter(track for _, track in proposals)
    return {path: track for path, track in proposals if paths[path] == 1 and tracks[track] == 1}


async def _find_moves(
    session: AsyncSession,
    root: Path,
    vanished: dict[str, _Known],
    new: dict[str, Stat],
) -> tuple[dict[str, uuid.UUID], set[str]]:
    """Pairs tracks whose file vanished with new paths holding the same file, so a moved or
    renamed file keeps its track id, and with it likes, playlist entries and play history.

    Matches by size + mtime first (what `mv` keeps), then by tags + duration (a copy that
    lost its mtime, or the file replaced by another encoding). Ambiguous matches are left
    alone. Returns {new path: track id} and the matched paths whose file must be re-read."""
    by_stat: dict[Stat, list[uuid.UUID]] = defaultdict(list)
    for known in vanished.values():
        by_stat[(known.size, known.mtime)].append(known.id)
    moved = _one_to_one(
        [(path, ids[0]) for path, stat in new.items() if len(ids := by_stat.get(stat, [])) == 1]
    )

    left_ids = {k.id for k in vanished.values()} - set(moved.values())
    left_paths = [path for path in new if path not in moved]
    if not left_ids or not left_paths:
        return moved, set()

    by_identity: dict[Identity, list[tuple[uuid.UUID, int]]] = defaultdict(list)
    for track_id, title, disc_no, track_no, duration_ms, album, album_artist in (
        await session.execute(
            select(
                Track.id,
                Track.title,
                Track.disc_no,
                Track.track_no,
                Track.duration_ms,
                Album.title,
                Artist.name,
            )
            .join(Album, Album.id == Track.album_id)
            .join(Artist, Artist.id == Album.artist_id)
            .where(Track.id == any_(literal(list(left_ids), ARRAY(Uuid))))
        )
    ).all():
        ident = _identity(album_artist, album, disc_no, track_no, title)
        by_identity[ident].append((track_id, duration_ms))

    proposals = []
    for path, (ident, duration_ms) in (
        await asyncio.to_thread(_read_identities, root, left_paths)
    ).items():
        candidates = [
            track_id
            for track_id, known_ms in by_identity.get(ident, [])
            if abs(known_ms - duration_ms) <= MOVE_DURATION_TOLERANCE_MS
        ]
        if len(candidates) == 1:
            proposals.append((path, candidates[0]))
    retagged = _one_to_one(proposals)
    return moved | retagged, set(retagged)


async def scan_library(ctx: JobContext, payload: dict[str, Any]) -> None:
    root = ctx.settings.library_path
    if not root.is_dir():
        raise FileNotFoundError(f"Library path does not exist: {root}")
    root = root.resolve()
    on_disk, images = await asyncio.to_thread(_walk, root)

    async with ctx.sessionmaker() as session:
        known = {
            row.path: _Known(row.id, row.size, row.mtime)
            for row in await session.execute(select(Track.id, Track.path, Track.size, Track.mtime))
        }
        vanished = {path: k for path, k in known.items() if path not in on_disk}
        new = {path: stat for path, stat in on_disk.items() if path not in known}
        moves, reread = await _find_moves(session, root, vanished, new)

        if moves:
            pairs = (
                func.unnest(
                    literal(list(moves.values()), ARRAY(Uuid)), literal(list(moves), ARRAY(String))
                )
                .table_valued("id", "path")
                .render_derived()
            )
            await session.execute(
                update(Track).where(Track.id == pairs.c.id).values(path=pairs.c.path)
            )
        moved_ids = set(moves.values())
        removed = [path for path, k in vanished.items() if k.id not in moved_ids]

        def needs_import(path: str, stat: Stat) -> bool:
            if path in moves:
                return path in reread
            k = known.get(path)
            return k is None or (k.size, k.mtime) != stat

        changed = [path for path, stat in on_disk.items() if needs_import(path, stat)]
        await enqueue_many(
            session, "import_track", [({"path": rel}, f"import:{rel}") for rel in changed]
        )
        if removed:
            await session.execute(
                delete(Track).where(Track.path == any_(literal(removed, ARRAY(String))))
            )
            await delete_orphans(session)

        # Folder images are not tracks, so a replaced cover.jpg is noticed here.
        first = (
            select(
                Track.album_id,
                Track.path,
                func.row_number()
                .over(partition_by=Track.album_id, order_by=(*TRACK_ORDER, Track.path))
                .label("n"),
            )
        ).subquery()
        folders: dict[uuid.UUID, set[str]] = defaultdict(set)
        for album_id, path in await session.execute(
            select(first.c.album_id, first.c.path).where(first.c.n <= ART_TRACKS)
        ):
            folders[album_id].add(posixpath.dirname(path))
        albums = [
            (row.id, row.cover_source, row.cover_mtime)
            for row in await session.execute(
                select(Album.id, Album.cover_source, Album.cover_mtime)
            )
        ]
        stale = _stale_covers(albums, folders, images)
        await enqueue_many(
            session, "album_cover", [({"album_id": str(a)}, f"cover:{a}") for a in stale]
        )

        if await session.scalar(select(exists().where(Cover.palette.is_(None)))):
            await enqueue(session, "cover_palettes", dedupe_key="cover_palettes")
        await session.commit()
    log.info(
        "scan: %d files, %d moved, %d to import, %d removed",
        len(on_disk),
        len(moves),
        len(changed),
        len(removed),
    )


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

        track = await session.scalar(select(Track).where(Track.path == rel))
        if track is None:
            track = Track(path=rel)
            session.add(track)
        previous_album_id = track.album_id
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
        library, covers = ctx.settings.library_path, ctx.settings.covers_path
        await choose_album_cover(session, library, covers, album)
        if previous_album_id not in (None, album.id):
            # Queried, not session.get(): delete_orphans may have just removed it.
            previous = await session.scalar(select(Album).where(Album.id == previous_album_id))
            if previous is not None:
                await choose_album_cover(session, library, covers, previous)

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
