"""Changing files in the music library: safe names, writes that tell a read-only library or
a full disk as such, moving and deleting a track's file together with its lyrics files, and
removing the folders that leaves empty."""

import asyncio
import errno
import hashlib
import os
import re
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import BinaryIO

from app.errors import ApiError, ErrorCode
from app.library.tags import FOLDER_COVER_NAMES, FOLDER_COVER_SUFFIXES
from app.lyrics.models import SIDECAR_SUFFIXES

_UNSAFE = re.compile(r"[^\w\-. ()\[\]&,']+", re.UNICODE)
MAX_NAME = 120  # characters of a file or folder name: Cyrillic takes 2 of the 255 bytes
MAX_DEPTH = 8
# Left behind by file managers; a folder holding only these (and its cover) is empty.
JUNK = frozenset({".ds_store", "thumbs.db", "desktop.ini"})


def safe_part(name: str) -> str:
    """A file or folder name with nothing that could reach outside its folder ("..", "/")
    or hide it (a leading dot); "" when nothing is left."""
    cleaned = _UNSAFE.sub("_", name).strip(" .")
    if len(cleaned) > MAX_NAME:
        stem, suffix = Path(cleaned).stem, Path(cleaned).suffix
        cleaned = stem[: MAX_NAME - len(suffix)].rstrip(" .") + suffix
    return cleaned


def safe_name(name: str) -> str:
    return safe_part(Path(name).name) or "upload"


def safe_folder(folder: str) -> Path:
    parts = [part for raw in folder.replace("\\", "/").split("/") if (part := safe_part(raw))]
    return Path(*parts[:MAX_DEPTH])


async def write[**P, R](func: Callable[P, R], *args: P.args, **kwargs: P.kwargs) -> R:
    """Runs a write to the library in a thread. A library mounted read-only or owned by
    another user, and a full disk, are told to the admin as such."""
    try:
        return await asyncio.to_thread(func, *args, **kwargs)
    except OSError as exc:
        if exc.errno == errno.ENOSPC:
            raise ApiError(ErrorCode.disk_full) from exc
        if isinstance(exc, PermissionError) or exc.errno == errno.EROFS:
            raise ApiError(ErrorCode.library_not_writable) from exc
        raise


def save_upload(src: BinaryIO, directory: Path, name: str) -> tuple[Path, str]:
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


def sha256(path: Path) -> str | None:
    try:
        with path.open("rb") as fh:
            return hashlib.file_digest(fh, "sha256").hexdigest()
    except OSError:
        return None


def sidecars(audio: Path) -> list[Path]:
    """The lyrics files beside an audio file, with its name."""
    return [s for s in (audio.with_suffix(x) for x in SIDECAR_SUFFIXES) if s.is_file()]


def move_track_file(audio: Path, directory: Path) -> Path:
    """Moves an audio file and its lyrics files into `directory`, under the first name free
    for all of them ("x.flac", "x (1).flac", ...). Returns where the audio file is now."""
    directory.mkdir(parents=True, exist_ok=True)
    if audio.parent.resolve() == directory.resolve():
        return audio
    lyrics = sidecars(audio)
    stem, n = audio.stem, 1
    while True:
        dest = directory / audio.name if n == 1 else directory / f"{stem} ({n - 1}){audio.suffix}"
        names = [dest, *(dest.with_suffix(s.suffix) for s in lyrics)]
        if not any(p.exists() for p in names):
            break
        n += 1
    shutil.move(audio, dest)
    for sidecar in lyrics:
        shutil.move(sidecar, dest.with_suffix(sidecar.suffix))
    return dest


def delete_track_file(audio: Path) -> None:
    """Deletes an audio file and its lyrics files; one already gone is no error."""
    for sidecar in sidecars(audio):
        sidecar.unlink(missing_ok=True)
    audio.unlink(missing_ok=True)


def _leftover(name: str) -> bool:
    path = Path(name)
    cover = (
        path.stem.casefold() in FOLDER_COVER_NAMES
        and path.suffix.casefold() in FOLDER_COVER_SUFFIXES
    )
    return cover or name.casefold() in JUNK


def prune(folder: Path, root: Path) -> None:
    """Removes `folder` and the folders above it (below `root`) that were left with no
    music: nothing in them but a cover image and file managers' junk. Anything else (a
    booklet, a .cue) keeps its folder."""
    root = root.resolve()
    current = folder.resolve()
    while current != root and current.is_relative_to(root):
        try:
            entries = list(os.scandir(current))
        except OSError:
            return
        if any(e.is_dir(follow_symlinks=False) or not _leftover(e.name) for e in entries):
            return
        for entry in entries:
            os.unlink(entry.path)
        current.rmdir()
        current = current.parent
