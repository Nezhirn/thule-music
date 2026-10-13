"""Reads metadata, embedded artwork and embedded lyrics from audio files via mutagen."""

import base64
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

import mutagen
from mutagen.flac import FLAC, Picture, VCFLACDict
from mutagen.id3 import ID3
from mutagen.mp4 import MP4

from app.jobs.queue import PermanentFailure
from app.library.models import name_key

UNKNOWN_ARTIST = "Unknown Artist"
UNKNOWN_ALBUM = "Unknown Album"
VARIOUS_ARTISTS = "Various Artists"

# Longest names and titles kept (the database columns' sizes).
MAX_NAME = 512
MAX_GENRE = 128

# Old taggers on Russian Windows wrote cp1251 where ID3 promises Latin-1, and the odd one into
# Vorbis comments, which must be UTF-8. Such text is read back in this encoding.
LEGACY_ENCODING = "cp1251"


class UnreadableAudio(PermanentFailure):
    """Not an audio file, or a damaged one: importing it again won't help until it changes
    (and then a scan imports it anyway)."""


@dataclass
class TrackTags:
    title: str
    # Credited artists, the main one first.
    artists: list[str]
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
    lyrics: str | None

    @property
    def artist(self) -> str:
        return self.artists[0]


def _from_legacy(text: str) -> str:
    """Undoes LEGACY_ENCODING text read as Latin-1 ("Ïåñíÿ" -> "Песня"), the usual state of
    old ID3 tags; also when a tool later saved it as Unicode. Real Latin-1 text ("Café",
    "Größe") stays: it is taken for this only when most of its letters come out Cyrillic."""
    if text.isascii():
        return text
    try:
        decoded = text.encode("latin-1").decode(LEGACY_ENCODING)
    except UnicodeError:
        return text
    letters = [c for c in decoded if c.isalpha()]
    cyrillic = sum("\u0400" <= c <= "\u04ff" for c in letters)
    return decoded if cyrillic * 2 > len(letters) else text


def _clean(value: object) -> str | None:
    """A tag value as text: legacy encodings repaired, whitespace and control characters
    collapsed to single spaces. None when nothing is left."""
    text = str(value)
    if any("\udc80" <= c <= "\udcff" for c in text):
        # Bytes that were not UTF-8, kept by _KeepBytesFLAC.
        text = text.encode("utf-8", "surrogateescape").decode(LEGACY_ENCODING, "replace")
    return " ".join(_from_legacy(text).split()) or None


def _values(tags, key: str) -> list[str]:
    if tags is None:
        return []
    try:
        values = tags.get(key)
    except (KeyError, ValueError):
        return []
    return [text for value in values or [] if (text := _clean(value))]


def _first(tags, key: str) -> str | None:
    return next(iter(_values(tags, key)), None)


def _clip(text: str, length: int = MAX_NAME) -> str:
    return text[:length].rstrip()


def _number(value: str | None) -> int | None:
    """'3/12' -> 3. None for no number, and for 0 (taggers' "unknown")."""
    match = re.match(r"\s*(\d+)", value or "")
    return int(match.group(1)) or None if match else None


def _year(value: str | None) -> int | None:
    """'2009-05-01' -> 2009; None unless it starts with a four-digit year ('20x4', '98')."""
    match = re.match(r"\s*(\d{4})(?!\d)", value or "")
    return int(match.group(1)) if match else None


# "A feat. B", "A ft. B", "A featuring B"; and "(feat. B)" / "[feat. B]" in artists and titles.
_FEAT = re.compile(r"\s+(?:feat\.?|ft\.?|featuring)\s+", re.IGNORECASE)
_FEAT_BRACKETS = re.compile(r"\s*[(\[](?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]", re.IGNORECASE)
# Between featured artists: "B, C & D".
_AND = re.compile(r"\s*(?:,|&)\s*")


def split_featured(text: str) -> tuple[str, list[str]]:
    """ "A feat. B & C" or "A (feat. B, C)" -> ("A", ["B", "C"]). The main part is never split
    at "&" or ",": band names have them ("Simon & Garfunkel")."""
    featured: list[str] = []

    def take(match: re.Match[str]) -> str:
        featured.extend(_AND.split(match.group(1)))
        return ""

    main, *rest = _FEAT.split(_FEAT_BRACKETS.sub(take, text), maxsplit=1)
    for names in rest:
        featured.extend(_AND.split(names))
    return main.strip(), [name for name in (n.strip() for n in featured) if name]


def _edit_featured(title: str, change: Callable[[str], str | None]) -> str:
    """The title with each artist it features ("Song (feat. A & B)", "Song feat. A") passed
    through `change`: a new name, or None to leave them out. The brackets and separators
    stay; "feat." with no one left goes."""

    def names(text: str) -> str:
        # Names and the separators between them.
        parts = re.split(f"({_AND.pattern})", text)
        kept: list[str] = []
        for i in range(0, len(parts), 2):
            name = change(parts[i])
            if name is None:
                continue
            if kept:
                kept.append(parts[i - 1])
            kept.append(name)
        return "".join(kept)

    def bracket(match: re.Match[str]) -> str:
        inner = names(match.group(1))
        if not inner:
            return ""
        start, end = match.start(1) - match.start(0), match.end(1) - match.start(0)
        return match.group(0)[:start] + inner + match.group(0)[end:]

    title = _FEAT_BRACKETS.sub(bracket, title)
    if (match := _FEAT.search(title)) is None:
        return title
    rest = names(title[match.end() :])
    return title[: match.end()] + rest if rest else title[: match.start()]


def rename_featured(title: str, old: str, new: str) -> str:
    """The title with an artist it features renamed: "Song (feat. Old)" -> "Song (feat.
    New)". Other titles stay as they are."""
    return _edit_featured(title, lambda name: new if name_key(name) == name_key(old) else name)


def remove_featured(title: str, artist: str) -> str:
    """The title without an artist it features: "Song (feat. A & B)" -> "Song (feat. B)",
    "Song (feat. A)" -> "Song". Other titles stay as they are."""
    return _edit_featured(title, lambda name: None if name_key(name) == name_key(artist) else name)


def _credits(artist_values: list[str], title: str | None) -> list[str]:
    """Everyone credited on a track, main artist first: each artist tag value (some files
    have several) with the artists it features, then those the title features ("Song (feat.
    B)"). Without any, UNKNOWN_ARTIST."""
    names: list[str] = []
    for value in artist_values:
        main, featured = split_featured(value)
        names += [main, *featured]
    if title:
        names += split_featured(title)[1]
    unique = {name_key(n): _clip(n) for n in reversed(names) if n}
    return list(reversed(unique.values())) or [UNKNOWN_ARTIST]


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


def embedded_picture(path: Path) -> bytes | None:
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


def embedded_lyrics(path: Path) -> str | None:
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
        values = tags.get(key)
        if values and (value := str(values[0]).strip()):
            return value
    return None


class _KeepBytesComments(VCFLACDict):
    """Vorbis comments that keep bytes which are not UTF-8 (as surrogates) for _clean,
    instead of replacing them with U+FFFD."""

    def load(self, data, errors="surrogateescape", framing=False):
        super().load(data, errors=errors, framing=framing)


class _KeepBytesFLAC(FLAC):
    METADATA_BLOCKS = [
        _KeepBytesComments if block is VCFLACDict else block for block in FLAC.METADATA_BLOCKS
    ]


def replaced_bytes(tags) -> bool:
    return isinstance(tags, VCFLACDict) and any(
        "\ufffd" in value for _, values in tags.items() for value in values
    )


def read_tags(path: Path, *, lyrics: bool = True) -> TrackTags:
    """`lyrics=False` skips embedded lyrics, which need another pass over the file."""
    try:
        audio = mutagen.File(path, easy=True)
        # Text that was not UTF-8 came out as U+FFFD: read it again, bytes kept.
        if isinstance(audio, FLAC) and replaced_bytes(audio.tags):
            audio = _KeepBytesFLAC(path)
    except mutagen.MutagenError as exc:
        raise UnreadableAudio(str(exc)) from exc
    if audio is None or audio.info is None:
        raise UnreadableAudio(f"Unsupported audio file: {path.name}")

    tags = audio.tags
    title = _first(tags, "title")
    artists = _credits(_values(tags, "artist"), title)
    album_artist = _first(tags, "albumartist")
    if album_artist:
        album_artist = split_featured(album_artist)[0] or album_artist
    elif _first(tags, "compilation") == "1":
        album_artist = VARIOUS_ARTISTS
    genre = _first(tags, "genre")
    bitrate = getattr(audio.info, "bitrate", None)
    return TrackTags(
        title=_clip(title or path.stem),
        artists=artists,
        album=_clip(_first(tags, "album") or UNKNOWN_ALBUM),
        album_artist=_clip(album_artist or artists[0]),
        year=_year(_first(tags, "date") or _first(tags, "year")),
        # mutagen reads an ID3 genre number it doesn't know, such as "(999)", as "Unknown".
        genre=_clip(genre, MAX_GENRE) if genre and genre.casefold() != "unknown" else None,
        track_no=_number(_first(tags, "tracknumber")),
        disc_no=_number(_first(tags, "discnumber")),
        duration_ms=int(round((audio.info.length or 0) * 1000)),
        codec=_codec(audio),
        bitrate=round(bitrate / 1000) if bitrate else None,
        sample_rate=getattr(audio.info, "sample_rate", None),
        lyrics=embedded_lyrics(path) if lyrics else None,
    )


FOLDER_COVER_NAMES = ("cover", "folder", "front", "album", "albumart")


FOLDER_COVER_SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")


def pick_folder_cover(filenames: Iterable[str]) -> str | None:
    """Of a folder's files, the one to use as album art: cover.jpg, folder.png, ..."""
    candidates = {
        Path(name).stem.casefold(): name
        for name in filenames
        if Path(name).suffix.casefold() in FOLDER_COVER_SUFFIXES
    }
    return next((candidates[n] for n in FOLDER_COVER_NAMES if n in candidates), None)


def folder_cover(directory: Path) -> Path | None:
    """Finds cover.jpg / folder.png / ... in a folder."""
    try:
        name = pick_folder_cover(p.name for p in directory.iterdir() if p.is_file())
    except OSError:
        return None
    return directory / name if name else None
