"""Library scanning and per-file import (runs inside the job worker)."""

import asyncio
import contextlib
import logging
import os
import posixpath
import re
import time
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from stat import S_ISREG
from typing import Any

from sqlalchemy import (
    ARRAY,
    String,
    Uuid,
    any_,
    delete,
    exists,
    func,
    literal,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import AUDIO_EXTENSIONS
from app.jobs.context import JobContext
from app.jobs.queue import enqueue, enqueue_many
from app.library.covers import is_image, store_cover
from app.library.models import Album, Artist, Cover, Track, TrackArtist, name_key
from app.library.queries import TRACK_ORDER
from app.library.tags import embedded_picture, folder_cover, pick_folder_cover, read_tags
from app.library.tagwrite import is_leftover_copy
from app.lyrics.models import MANUAL, SIDECAR_SUFFIXES, Lyrics

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

# A copy left by a tag write this long ago is no write in progress (see tagwrite).
LEFTOVER_AGE = 3600

# A scan that would remove more tracks than this, and more than a fifth of the library,
# removes none until told to (see scan_library).
MASS_REMOVAL = 50


# A disc folder of a multi-disc album ("CD1", "Disc 2 - Live", "Диск 1"): its art is often in
# the album folder above it.
_DISC_FOLDER = re.compile(r"(?:cd|disc|disk|диск)\s*\d+\b", re.IGNORECASE)


def art_folders(folder: str) -> list[str]:
    """Folders whose image may be the art of tracks in `folder` (library-relative), in order
    of preference: the folder itself and, for a disc folder, the one above."""
    if _DISC_FOLDER.match(posixpath.basename(folder)):
        return [folder, posixpath.dirname(folder)]
    return [folder]


@dataclass
class _Walked:
    # Audio files as {path: (size, mtime)}.
    found: dict[str, Stat]
    # The album art image of each folder that has one, as {folder: (image path, mtime)}.
    images: dict[str, tuple[str, float]]
    # The audio files with lyrics beside them (.lrc, .txt), as {path: newest mtime of those}.
    lyrics: dict[str, float]
    # Folders and files that couldn't be read (a disk gone, a link to one, no permission):
    # what is known under them is not taken for deleted.
    unreadable: set[str]
    # Copies left by tag writes that were cut short (see tagwrite.write_tags).
    leftovers: list[Path]


def _rel(root: Path, path: str | Path) -> str:
    rel = Path(path).relative_to(root).as_posix()
    return "" if rel == "." else rel


def _walk(root: Path) -> _Walked:
    """What is in the library folder; paths relative to the root, the root folder is ""."""
    walked = _Walked({}, {}, {}, set(), [])
    found, images, lyrics = walked.found, walked.images, walked.lyrics

    def unreadable(error: OSError) -> None:
        try:
            walked.unreadable.add(_rel(root, error.filename))
        except (TypeError, ValueError):
            walked.unreadable.add("")  # can't tell where: nothing is taken for deleted

    # (st_dev, st_ino) of the directories from the root down to each visited one. Symlinks
    # are followed, so a link back to an ancestor would otherwise repeat the subtree.
    ancestry: dict[str, frozenset[tuple[int, int]]] = {}
    for dirpath, dirnames, filenames in os.walk(root, onerror=unreadable, followlinks=True):
        try:
            dir_st = os.stat(dirpath)
        except OSError:
            walked.unreadable.add(_rel(root, dirpath))
            dirnames[:] = []
            continue
        dir_id = (dir_st.st_dev, dir_st.st_ino)
        above = ancestry.get(os.path.dirname(dirpath), frozenset())
        if dir_id in above:
            dirnames[:] = []
            continue
        ancestry[dirpath] = above | {dir_id}
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        rel_dir = _rel(root, dirpath)
        if image := pick_folder_cover(n for n in filenames if not n.startswith(".")):
            with contextlib.suppress(OSError):
                mtime = os.stat(Path(dirpath, image)).st_mtime
                images[rel_dir] = (posixpath.join(rel_dir, image), mtime)
        names = set(filenames)
        for name in filenames:
            if name.startswith("."):
                if is_leftover_copy(name):
                    with contextlib.suppress(OSError):
                        # ctime: a copy keeps the file's mtime until it is written.
                        if os.stat(Path(dirpath, name)).st_ctime < time.time() - LEFTOVER_AGE:
                            walked.leftovers.append(Path(dirpath, name))
                continue
            full = Path(dirpath, name)
            if Path(name).suffix.casefold() not in AUDIO_EXTENSIONS:
                # A link to a folder whose disk is gone is listed as a file.
                if full.is_symlink() and not full.exists():
                    walked.unreadable.add(_rel(root, full))
                continue
            try:
                st = full.stat()
            except FileNotFoundError:
                continue  # deleted while the folder was read
            except OSError:
                walked.unreadable.add(_rel(root, full))
                continue
            rel = _rel(root, full)
            found[rel] = (st.st_size, st.st_mtime)
            for sidecar in (full.with_suffix(suffix) for suffix in SIDECAR_SUFFIXES):
                if sidecar.name in names:
                    with contextlib.suppress(OSError):
                        lyrics[rel] = max(lyrics.get(rel, 0.0), sidecar.stat().st_mtime)
    return walked


def _remove(paths: list[Path]) -> None:
    for path in paths:
        with contextlib.suppress(OSError):
            path.unlink()


def _under(path: str, folders: set[str]) -> bool:
    """Whether the library path is one of `folders` or inside one ("" is the root)."""
    return any(f == "" or path == f or path.startswith(f + "/") for f in folders)


def _gone(root: Path, paths: list[str]) -> list[str]:
    """The paths whose file is certainly not there: not found, rather than unreadable."""
    gone = []
    for rel in paths:
        try:
            os.stat(resolve_in_library(root, rel))
        except (FileNotFoundError, NotADirectoryError):
            gone.append(rel)
        except OSError:
            continue
    return gone


def library_is_empty(root: Path) -> bool:
    """Nothing at all in the library folder: most likely its disk is not mounted."""
    try:
        with os.scandir(root) as entries:
            return next(entries, None) is None
    except OSError:
        return True


def _album_picture(root: Path, paths: list[str]) -> tuple[bytes, str, float] | None:
    """An album's art, from its first tracks' paths in track order: the first folder image
    (cover.jpg, folder.png, ...; above a disc folder too), else the first embedded artwork.
    Returns (image bytes, the library path it came from, that file's mtime)."""
    folders = list(dict.fromkeys(f for rel in paths for f in art_folders(posixpath.dirname(rel))))
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
    import of one of its tracks, and when a scan sees one of its folder images change. A
    cover an admin chose is kept."""
    # Locked until the commit: an admin choosing a cover meanwhile waits, then wins.
    await session.refresh(album, ["cover_custom"], with_for_update=True)
    if album.cover_custom:
        return
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
            ~exists().where(TrackArtist.artist_id == Artist.id),
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


async def _stale_lyrics(
    session: AsyncSession, tracks: dict[str, uuid.UUID], sidecars: dict[str, float]
) -> list[uuid.UUID]:
    """Tracks ({path: id}) whose lyrics must be fetched again: a lyrics file beside the
    track that they don't come from yet or that changed since, or one they came from that
    is gone. Lyrics an admin wrote stay."""
    with_file = [tracks[path] for path in sidecars if path in tracks]
    fetched = {
        row.track_id: row
        for row in await session.execute(
            select(Lyrics.track_id, Lyrics.source, Lyrics.fetched_at).where(
                or_(
                    Lyrics.source == "sidecar",
                    Lyrics.track_id == any_(literal(with_file, ARRAY(Uuid))),
                )
            )
        )
    }
    stale = []
    for path, track_id in tracks.items():
        row = fetched.get(track_id)
        mtime = sidecars.get(path)
        if row is not None and row.source == MANUAL:
            continue  # an admin's text wins over the files
        if mtime is None:
            if row is not None and row.source == "sidecar":
                stale.append(track_id)
        elif row is None or row.source != "sidecar" or mtime > row.fetched_at.timestamp():
            stale.append(track_id)
    return stale


async def scan_library(ctx: JobContext, payload: dict[str, Any]) -> dict[str, int]:
    """Compares the library folder with the database and queues the work that follows. The
    counts it returns are files: added and updated ones are queued for import, not yet done.

    Tracks are removed only when their file is certainly gone. Under a folder that couldn't
    be read they stay (`unreadable`). When the folder is empty, or more than MASS_REMOVAL
    tracks and a fifth of the library vanished at once, nothing is removed (`missing`) until
    the scan runs with `remove_missing`: the disk is more likely unmounted than the music
    deleted, and removing a track takes its likes, playlist entries and plays with it."""
    root = ctx.settings.library_path
    if not root.is_dir():
        raise FileNotFoundError(f"Library path does not exist: {root}")
    root = root.resolve()

    # Read before the folder: what is imported or moved while it is read is then at worst
    # found new (and imported again), never taken for deleted.
    async with ctx.sessionmaker() as session:
        known = {
            row.path: _Known(row.id, row.size, row.mtime)
            for row in await session.execute(select(Track.id, Track.path, Track.size, Track.mtime))
        }
    walked = await asyncio.to_thread(_walk, root)
    on_disk, images, sidecars = walked.found, walked.images, walked.lyrics
    if walked.unreadable:
        log.warning("scan: couldn't read %s", ", ".join(sorted(walked.unreadable)[:20]))
    if walked.leftovers:
        log.info("scan: removing %d copies left by cut-short tag writes", len(walked.leftovers))
        await asyncio.to_thread(_remove, walked.leftovers)

    async with ctx.sessionmaker() as session:
        not_found = [path for path in known if path not in on_disk]
        unreadable = [path for path in not_found if _under(path, walked.unreadable)]
        vanished = {path: known[path] for path in not_found if not _under(path, walked.unreadable)}
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
        removed = await asyncio.to_thread(_gone, root, removed)
        missing = 0
        if removed and not payload.get("remove_missing"):
            mass = len(removed) > MASS_REMOVAL and len(removed) * 5 > len(known)
            if not on_disk or mass:
                log.warning(
                    "scan: %d of %d tracks not found, none removed: is the music folder "
                    "mounted? Scan with remove_missing to remove them",
                    len(removed),
                    len(known),
                )
                missing, removed = len(removed), []

        def needs_import(path: str, stat: Stat) -> bool:
            if path in moves:
                return path in reread
            k = known.get(path)
            return k is None or (k.size, k.mtime) != stat

        changed = [path for path, stat in on_disk.items() if needs_import(path, stat)]
        await enqueue_many(
            session, "import_track", [({"path": rel}, f"import:{rel}") for rel in changed]
        )

        # Lyrics files are not tracks either: one added, edited or removed beside a track
        # that isn't imported again (which would fetch its lyrics) is noticed here.
        importing = set(changed)
        kept = {
            path: moves[path] if path in moves else known[path].id
            for path in on_disk
            if path not in importing and (path in moves or path in known)
        }
        stale_lyrics = await _stale_lyrics(session, kept, sidecars)
        await enqueue_many(
            session,
            "fetch_lyrics",
            [({"track_id": str(i)}, f"lyrics:{i}") for i in stale_lyrics],
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
            folders[album_id].update(art_folders(posixpath.dirname(path)))
        albums = [
            (row.id, row.cover_source, row.cover_mtime)
            for row in await session.execute(
                select(Album.id, Album.cover_source, Album.cover_mtime).where(~Album.cover_custom)
            )
        ]
        stale = _stale_covers(albums, folders, images)
        await enqueue_many(
            session, "album_cover", [({"album_id": str(a)}, f"cover:{a}") for a in stale]
        )

        if await session.scalar(select(exists().where(Cover.palette.is_(None)))):
            await enqueue(session, "cover_palettes", dedupe_key="cover_palettes")
        await session.commit()
    result = {
        "files": len(on_disk),
        "added": sum(1 for path in changed if path not in known and path not in moves),
        "updated": sum(1 for path in changed if path in known),
        "moved": len(moves),
        "removed": len(removed),
        "missing": missing,
        "unreadable": len(unreadable),
    }
    log.info("scan: %s", result)
    return result


async def upsert_artist(session: AsyncSession, name: str) -> uuid.UUID:
    key = name_key(name)
    await session.execute(
        insert(Artist).values(id=uuid.uuid4(), name=name, name_key=key).on_conflict_do_nothing()
    )
    artist_id = await session.scalar(select(Artist.id).where(Artist.name_key == key))
    assert artist_id is not None
    return artist_id


async def upsert_album(
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


class LibraryUnavailable(Exception):
    """The library folder is empty or unreadable: its disk is most likely not mounted, and
    files missing from it are not taken for deleted."""


def _stat_file(library: Path, full: Path) -> os.stat_result | None:
    """The file's stat; None when it is gone. Raises LibraryUnavailable rather than say a
    file is gone from a library folder that is empty, and OSError when it can't be read."""
    try:
        st = full.stat()
    except (FileNotFoundError, NotADirectoryError):
        if library_is_empty(library):
            raise LibraryUnavailable(f"The library folder is empty: {library}") from None
        return None
    if not S_ISREG(st.st_mode):
        return None
    return st


@dataclass
class Imported:
    track: Track
    album: Album
    # The album the track was in before, when it moved to another.
    previous_album_id: uuid.UUID | None
    # Embedded lyrics, for fetch_lyrics.
    lyrics: str | None


async def import_file(session: AsyncSession, library: Path, rel: str) -> Imported | None:
    """Reads a file's tags into its track: artists and album created as needed, the track
    created or updated. None when the file is gone (its track is deleted). Leaves to the
    caller what is done once for several files: orphans, album covers, follow-up jobs."""
    full = resolve_in_library(library, rel)
    st = await asyncio.to_thread(_stat_file, library, full)
    if st is None:
        await session.execute(delete(Track).where(Track.path == rel))
        return None
    tags = await asyncio.to_thread(read_tags, full)

    album_artist_id = await upsert_artist(session, tags.album_artist)
    artist_ids = [
        album_artist_id
        if name_key(name) == name_key(tags.album_artist)
        else await upsert_artist(session, name)
        for name in tags.artists
    ]
    album = await upsert_album(session, tags.album, album_artist_id, tags.year, tags.genre)

    track = await session.scalar(select(Track).where(Track.path == rel))
    if track is None:
        track = Track(path=rel)
        session.add(track)
    previous_album_id = track.album_id
    track.title = tags.title
    track.album_id = album.id
    track.artist_id = artist_ids[0]
    track.disc_no = tags.disc_no
    track.track_no = tags.track_no
    track.duration_ms = tags.duration_ms
    track.size = st.st_size
    track.mtime = st.st_mtime
    track.codec = tags.codec
    track.bitrate = tags.bitrate
    track.sample_rate = tags.sample_rate
    await session.flush()
    await session.execute(delete(TrackArtist).where(TrackArtist.track_id == track.id))
    await session.execute(
        insert(TrackArtist).values(
            [
                {"track_id": track.id, "position": i, "artist_id": artist_id}
                for i, artist_id in enumerate(artist_ids)
            ]
        )
    )
    moved_from = previous_album_id if previous_album_id not in (None, album.id) else None
    return Imported(track, album, moved_from, tags.lyrics)


async def choose_covers(
    session: AsyncSession, library: Path, covers: Path, album_ids: set[uuid.UUID]
) -> None:
    """Chooses the covers of these albums again, of those that still exist."""
    for album in await session.scalars(select(Album).where(Album.id.in_(album_ids))):
        await choose_album_cover(session, library, covers, album)


async def queue_follow_ups(session: AsyncSession, imported: Imported, *, transcode: bool) -> None:
    """The work an imported track needs: transcodes (unless only its tags changed) and a
    lyrics lookup."""
    track_id = str(imported.track.id)
    if transcode:
        await enqueue(
            session, "transcode", {"track_id": track_id}, dedupe_key=f"transcode:{track_id}"
        )
    await enqueue(
        session,
        "fetch_lyrics",
        {"track_id": track_id, "embedded": imported.lyrics},
        dedupe_key=f"lyrics:{track_id}",
    )


async def import_track(ctx: JobContext, payload: dict[str, Any]) -> None:
    rel: str = payload["path"]
    async with ctx.sessionmaker() as session:
        imported = await import_file(session, ctx.settings.library_path, rel)
        # A re-import may move the track to another album; drop what that left empty.
        await delete_orphans(session)
        if imported is not None:
            album_ids = {imported.album.id}
            if imported.previous_album_id is not None:
                album_ids.add(imported.previous_album_id)
            await choose_covers(
                session, ctx.settings.library_path, ctx.settings.covers_path, album_ids
            )
            await queue_follow_ups(session, imported, transcode=True)
        await session.commit()
