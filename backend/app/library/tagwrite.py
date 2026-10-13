"""Writes the tags Thule reads (see app.library.tags) back into audio files: what admins
change in the library goes into the files, so a scan reads the same thing."""

from collections.abc import Mapping
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
    can't tag, and OSError when the file can't be written."""
    try:
        audio = mutagen.File(path, easy=True)
        if not isinstance(audio, WRITABLE):
            raise TagsNotWritable(path.name)
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
        audio.save()
    except mutagen.MutagenError as exc:
        # mutagen wraps what went wrong with the file itself: told as such.
        if isinstance(exc.__context__, OSError):
            raise exc.__context__ from exc
        raise TagsNotWritable(f"{path.name}: {exc}") from exc
