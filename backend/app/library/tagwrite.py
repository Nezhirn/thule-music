"""Writes the tags Thule reads (see app.library.tags) back into audio files: what admins
change in the library goes into the files, so a scan reads the same thing."""

import os
import re
import secrets
import shutil
import stat
import threading
import weakref
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import mutagen
from mutagen.easymp4 import EasyMP4
from mutagen.flac import FLAC
from mutagen.mp3 import EasyMP3
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis

from app.library.tags import read_tags, replaced_bytes

# Formats whose tags are read with mutagen's "easy" keys, so they are written with them too.
# WAV, WMA and raw AAC keep their tags in ways the reader doesn't read.
WRITABLE = (EasyMP3, FLAC, OggVorbis, OggOpus, EasyMP4)
WRITABLE_SUFFIXES = frozenset({".mp3", ".flac", ".ogg", ".opus", ".m4a"})

# A value per key: text, several values (artist: the main one, then the featured ones), or
# None to remove the tag. Keys: title, artist, album, albumartist, date, genre, tracknumber,
# discnumber.
Values = Mapping[str, str | list[str] | None]


class TagsNotWritable(Exception):
    """The file's format keeps no tags Thule can write."""


def can_write(path: Path) -> bool:
    return path.suffix.casefold() in WRITABLE_SUFFIXES


def _repaired(path: Path) -> dict[str, str | list[str]]:
    """The main tags as read (legacy encodings repaired), for files whose Vorbis comments
    hold bytes that aren't UTF-8: saving would write them back as U+FFFD."""
    tags = read_tags(path, lyrics=False)
    return {
        "title": tags.title,
        "artist": tags.artists,
        "album": tags.album,
        "albumartist": tags.album_artist,
        **({"genre": tags.genre} if tags.genre else {}),
    }


def write_tags(path: Path, values: Values) -> None:
    """Sets the given tags and leaves the others. Raises TagsNotWritable for formats it
    can't tag, and OSError when the file can't be written.

    The file is often the only copy of the music, so a write cut short (the process killed,
    the power gone) must leave it whole. Tags that fit the room the file keeps for them
    (padding) are written in place: MP3 and FLAC keep that room before the audio and take
    it in one write, which a killed process can't cut. Otherwise the audio would have to
    move along, so the tags go into a copy beside the file that then replaces it, with
    room to spare for the next change. In place even then only when a copy couldn't be
    just like the file: another owner the server can't give the copy, hard links that would
    no longer share it, a folder the server can't write to, no room for a copy."""
    target = path.resolve()  # a link: the file it points to is the one changed
    with _lock(target):
        if target.suffix.casefold() in IN_ONE_WRITE:
            try:
                _write(target, values, name=path.name, padding=_in_the_room)
                return
            except _WouldMove:
                pass
        copy = _copy_beside(target)
        if copy is None:
            _write(target, values, name=path.name, padding=_with_room)
            return
        try:
            _write(copy, values, name=path.name, padding=_with_room)
            _fsync(copy)
            os.replace(copy, target)
        except BaseException:
            copy.unlink(missing_ok=True)
            raise
        _fsync(target.parent)


# Formats whose tags mutagen rewrites with one write when they fit their room: ID3 at the
# start of an MP3, FLAC's metadata blocks. (Ogg pages and MP4 atoms take several.)
IN_ONE_WRITE = frozenset({".mp3", ".flac"})
# Room left for tags when a file is rewritten anyway, so later changes fit in place.
ROOM = 16 * 1024


class _WouldMove(Exception):
    """The new tags don't fit: the audio would move along."""


def _in_the_room(info: mutagen.PaddingInfo) -> int:
    if info.padding < 0:
        raise _WouldMove
    return info.padding


def _with_room(info: mutagen.PaddingInfo) -> int:
    return max(info.padding, ROOM)


# The copy a write goes to, beside the file: hidden (scans skip it) and with the file's
# extension (mutagen tells some formats by it).
_COPY = re.compile(r"^\.thule-[0-9a-f]{12}\.[^.]+$")


def is_leftover_copy(name: str) -> bool:
    """A copy of a write that was cut short (see write_tags)."""
    return bool(_COPY.match(name))


def _copy_beside(target: Path) -> Path | None:
    """A copy of the file beside it, with its owner, mode and times; None when it can't be
    just like the file (see write_tags)."""
    st = target.stat()
    if st.st_nlink > 1:
        return None
    copy = target.with_name(f".thule-{secrets.token_hex(6)}{target.suffix}")
    try:
        shutil.copy2(target, copy)
        made = copy.stat()
        if (made.st_uid, made.st_gid) != (st.st_uid, st.st_gid):
            os.chown(copy, st.st_uid, st.st_gid)
            os.chmod(copy, stat.S_IMODE(st.st_mode))  # chown may drop setuid bits
    except OSError:
        copy.unlink(missing_ok=True)
        return None
    return copy


def _fsync(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


# Writes to one file are one at a time: two at once would each copy it before the other's
# change. (Tags are written by the API process only.)
_locks: weakref.WeakValueDictionary[Path, threading.Lock] = weakref.WeakValueDictionary()
_locks_lock = threading.Lock()


def _lock(path: Path) -> threading.Lock:
    with _locks_lock:
        lock = _locks.get(path)
        if lock is None:
            lock = _locks[path] = threading.Lock()
        return lock


def _write(
    path: Path,
    values: Values,
    *,
    name: str,
    padding: Callable[[mutagen.PaddingInfo], int],
) -> None:
    try:
        audio = mutagen.File(path, easy=True)
        if not isinstance(audio, WRITABLE):
            raise TagsNotWritable(name)
        if audio.tags is None:
            audio.add_tags()
        tags: Any = audio.tags  # easy tags of whichever format: a mapping of lists
        changes = dict(values)
        if isinstance(audio, FLAC) and replaced_bytes(tags):
            changes = {**_repaired(path), **changes}
        for key, value in changes.items():
            if value is None:
                if key in tags:
                    del tags[key]
            else:
                tags[key] = value
        audio.save(padding=padding)
    except mutagen.MutagenError as exc:
        # mutagen wraps what went wrong with the file itself: told as such.
        if isinstance(exc.__context__, OSError):
            raise exc.__context__ from exc
        raise TagsNotWritable(f"{name}: {exc}") from exc
