"""Reads metadata, embedded artwork and embedded lyrics from audio files via mutagen."""

import base64
import re
from dataclasses import dataclass
from pathlib import Path

import mutagen
from mutagen.flac import FLAC, Picture
from mutagen.id3 import ID3
from mutagen.mp4 import MP4

UNKNOWN_ARTIST = "Unknown Artist"
UNKNOWN_ALBUM = "Unknown Album"


class UnreadableAudio(Exception):
    pass


@dataclass
class TrackTags:
    title: str
    artist: str
    album: str
    album_artist: str
    year: int | None
    genre: str | None
    track_no: int | None
    disc_no: int | None
    duration_ms: int
    codec: str
    bitrate: int | None  # kbit/s
    sample_rate: int | None
    picture: bytes | None
    lyrics: str | None


def _first(tags, key: str) -> str | None:
    if tags is None:
        return None
    try:
        values = tags.get(key)
    except (KeyError, ValueError):
        return None
    if not values:
        return None
    value = str(values[0]).strip()
    return value or None


def _leading_int(value: str | None) -> int | None:
    """'3/12' -> 3, '2009-05-01' -> 2009."""
    if not value:
        return None
    match = re.match(r"\s*(\d+)", value)
    return int(match.group(1)) if match else None


def _codec(audio) -> str:
    name = type(audio).__name__.lower()
    return {
        "easyid3": "mp3",
        "mp3": "mp3",
        "easymp3": "mp3",
        "flac": "flac",
        "oggvorbis": "vorbis",
        "oggopus": "opus",
        "easymp4": "aac",
        "mp4": "aac",
        "wave": "wav",
        "asf": "wma",
    }.get(name, name)


def _embedded_picture(path: Path) -> bytes | None:
    audio = mutagen.File(path)
    if audio is None:
        return None
    if isinstance(audio, FLAC) and audio.pictures:
        front = [p for p in audio.pictures if p.type == 3]
        return (front or audio.pictures)[0].data
    if isinstance(audio, MP4):
        covers = audio.tags.get("covr") if audio.tags else None
        return bytes(covers[0]) if covers else None
    tags = audio.tags
    if isinstance(tags, ID3):
        frames = tags.getall("APIC")
        front = [f for f in frames if f.type == 3]
        return (front or frames)[0].data if frames else None
    if tags is not None and hasattr(tags, "get"):
        # Vorbis comments (Ogg Vorbis / Opus)
        blocks = tags.get("metadata_block_picture")
        if blocks:
            try:
                return Picture(base64.b64decode(blocks[0])).data
            except Exception:
                return None
    return None


def _embedded_lyrics(path: Path) -> str | None:
    audio = mutagen.File(path)
    if audio is None or audio.tags is None:
        return None
    tags = audio.tags
    if isinstance(tags, ID3):
        frames = tags.getall("USLT")
        if frames:
            return str(frames[0].text).strip() or None
        # Some taggers (and ffmpeg) write lyrics into a user-defined TXXX frame instead.
        for frame in tags.getall("TXXX"):
            if frame.desc.upper() in {"LYRICS", "UNSYNCEDLYRICS", "USLT"} and frame.text:
                return str(frame.text[0]).strip() or None
        return None
    if isinstance(audio, MP4):
        values = tags.get("\xa9lyr")
        return str(values[0]).strip() or None if values else None
    for key in ("LYRICS", "lyrics", "UNSYNCEDLYRICS", "unsyncedlyrics"):
        value = _first(tags, key)
        if value:
            return value
    return None


def read_tags(path: Path) -> TrackTags:
    try:
        audio = mutagen.File(path, easy=True)
    except mutagen.MutagenError as exc:
        raise UnreadableAudio(str(exc)) from exc
    if audio is None or audio.info is None:
        raise UnreadableAudio(f"Unsupported audio file: {path.name}")

    tags = audio.tags
    artist = _first(tags, "artist") or UNKNOWN_ARTIST
    bitrate = getattr(audio.info, "bitrate", None)
    return TrackTags(
        title=_first(tags, "title") or path.stem,
        artist=artist,
        album=_first(tags, "album") or UNKNOWN_ALBUM,
        album_artist=_first(tags, "albumartist") or artist,
        year=_leading_int(_first(tags, "date") or _first(tags, "year")),
        genre=_first(tags, "genre"),
        track_no=_leading_int(_first(tags, "tracknumber")),
        disc_no=_leading_int(_first(tags, "discnumber")),
        duration_ms=int(round((audio.info.length or 0) * 1000)),
        codec=_codec(audio),
        bitrate=round(bitrate / 1000) if bitrate else None,
        sample_rate=getattr(audio.info, "sample_rate", None),
        picture=_embedded_picture(path),
        lyrics=_embedded_lyrics(path),
    )


FOLDER_COVER_NAMES = ("cover", "folder", "front", "album", "albumart")


def folder_cover(directory: Path) -> Path | None:
    """Finds cover.jpg / folder.png / ... next to the audio file."""
    try:
        candidates = {p.stem.casefold(): p for p in directory.iterdir() if p.is_file()}
    except OSError:
        return None
    for name in FOLDER_COVER_NAMES:
        p = candidates.get(name)
        if p is not None and p.suffix.casefold() in {".jpg", ".jpeg", ".png", ".webp"}:
            return p
    return None
