"""Reads metadata, embedded artwork and embedded lyrics from audio files via mutagen."""

import base64
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath

import mutagen
from mutagen.apev2 import APETextValue, APEv2
from mutagen.flac import FLAC, Picture, VCFLACDict
from mutagen.id3 import ID3
from mutagen.mp3 import EasyMP3
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
    # The fields the file's tags leave out, filled from its folders and name or with a
    # placeholder (UNKNOWN_ARTIST): "title", "artist", "album", "album_artist", "year",
    # "track_no", "disc_no".
    guessed: frozenset[str] = field(default=frozenset())

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


class _Ape:
    """APEv2 tags read like mutagen's easy ones ("artist", "tracknumber"): what some taggers
    (foobar2000, for one) leave in MP3 files instead of ID3."""

    KEYS = {
        "title": "title",
        "artist": "artist",
        "album": "album",
        "albumartist": "album artist",
        "date": "year",
        "genre": "genre",
        "tracknumber": "track",
        "discnumber": "disc",
        "compilation": "compilation",
    }

    def __init__(self, tags: APEv2):
        self.tags = tags

    def get(self, key: str) -> list[str]:
        value = self.tags.get(self.KEYS.get(key, key))
        return list(value) if isinstance(value, APETextValue) else []


def _ape(path: Path) -> _Ape | None:
    try:
        return _Ape(APEv2(path))
    except mutagen.MutagenError:
        return None


def read_tags(path: Path, *, lyrics: bool = True, place: PurePosixPath | None = None) -> TrackTags:
    """`lyrics=False` skips embedded lyrics, which need another pass over the file. `place`:
    the file's path inside the library, whose folders and name stand in for the tags it
    lacks (see from_path)."""
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
    if isinstance(audio, EasyMP3) and not any(
        _first(tags, key) for key in ("title", "artist", "album")
    ):
        tags = _ape(path) or tags
    title = _first(tags, "title")
    artist_values = _values(tags, "artist")
    album = _first(tags, "album")
    album_artist = _first(tags, "albumartist")
    year = _year(_first(tags, "date") or _first(tags, "year"))
    track_no = _number(_first(tags, "tracknumber"))
    disc_no = _number(_first(tags, "discnumber"))
    found = {
        "title": title,
        "artist": artist_values,
        "album": album,
        "year": year,
        "track_no": track_no,
        "disc_no": disc_no,
    }
    guessed = {name for name, value in found.items() if not value}

    says = from_path(place, next(iter(artist_values), None)) if place else None
    if says:
        title = title or says.title
        artist_values = artist_values or ([says.artist] if says.artist else [])
        album = album or says.album
        year = year or says.year
        track_no = track_no or says.track_no
        disc_no = disc_no or says.disc_no

    artists = _credits(artist_values, title)
    if album_artist:
        album_artist = split_featured(album_artist)[0] or album_artist
    elif _first(tags, "compilation") == "1":
        album_artist = VARIOUS_ARTISTS
    elif "artist" in guessed:
        guessed.add("album_artist")
        album_artist = says.album_artist if says else None
    genre = _first(tags, "genre")
    bitrate = getattr(audio.info, "bitrate", None)
    return TrackTags(
        title=_clip(title or path.stem),
        artists=artists,
        album=_clip(album or UNKNOWN_ALBUM),
        album_artist=_clip(album_artist or artists[0]),
        year=year,
        # mutagen reads an ID3 genre number it doesn't know, such as "(999)", as "Unknown".
        genre=_clip(genre, MAX_GENRE) if genre and genre.casefold() != "unknown" else None,
        track_no=track_no,
        disc_no=disc_no,
        duration_ms=int(round((audio.info.length or 0) * 1000)),
        codec=_codec(audio),
        bitrate=round(bitrate / 1000) if bitrate else None,
        sample_rate=getattr(audio.info, "sample_rate", None),
        lyrics=embedded_lyrics(path) if lyrics else None,
        guessed=frozenset(guessed),
    )


# --- what the path says ----------------------------------------------------------------------

# Between an artist and a title, an artist and an album, an album and its year: a dash with
# spaces around it ("AC-DC" and "Jay-Z" have none).
_DASH = re.compile(r"\s+[-–—]\s+")
# A file name's track number: "01 - ", "01. ", "1) ", "01_", "07 " (zero-padded only:
# "99 Problems" is a title), "1-01 " (disc and track).
_NUMBER = re.compile(
    r"(?:(?P<disc>\d)-(?P<track>\d{2})\s+"
    r"|(?P<number>\d{1,3})\s*(?:[)_\]]|\.(?!\d)|[-–—])"
    r"|(?P<padded>0\d{1,2})\s)"
    r"\s*(?=\S)"
)
_YEAR = r"(?P<year>(?:19|20)\d{2})"
# A year starting a folder's name: "2018 - Album", "2018. Album", "[2018] Album".
_YEAR_FIRST = re.compile(
    rf"[\[(]?{_YEAR}(?:[\])]\s*(?:[-–—.]\s*)?|\s*(?:[-–—]|\.(?!\d))\s*)(?P<rest>\S.*)"
)
# A year ending it: "Album - 2018".
_YEAR_LAST = re.compile(rf"(?P<rest>.*\S)\s+[-–—]\s+{_YEAR}")
# "Artist - 2018 - Album"
_ARTIST_YEAR = re.compile(
    rf"(?P<artist>.+?)\s+[-–—]\s+[\[(]?{_YEAR}[\])]?\s+[-–—]\s+(?P<rest>\S.*)"
)
# Something in brackets ending a folder's name: "Album (2018) [EP]".
_BRACKETS_LAST = re.compile(r"\s*[\[(](?P<inner>[^\[\]()]*)[\])]\s*$")
# What such brackets say that isn't the album's name: what it was released as, and the
# format, quality and source of the files ("[EP]", "(320 kbps)", "[FLAC 24-96]", "[WEB]").
_NOTE = re.compile(
    r"ep|single|maxi-?single|lp|"
    r"flac|mp3|aac|alac|ogg|opus|wav|ape|wv|m4a|lossless|hi-?res|vbr|cbr|v[02]|"
    r"web|web-?dl|webrip|cd|cdrip|vinyl|vinylrip|rip|"
    r"kbps|kbit/s|khz|bit|\d{2,3}\s*(?:k|kbps|kbit/s)?|\d{2}\s*bit|"
    r"\d{2}(?:\s*bit)?\s*[-/]\s*\d{2,3}(?:[.,]\d)?\s*(?:khz)?|\d{2,3}(?:[.,]\d)?\s*khz",
    re.IGNORECASE,
)
# A disc's own folder inside an album's: "CD1", "Disc 2", "Диск 1".
_DISC = re.compile(r"(?:cd|dis[ck]|диск)\s*[-_.]?\s*(?P<disc>\d{1,2})\b", re.IGNORECASE)
# Folders that hold albums by many artists.
_VARIOUS = {
    "various artists",
    "various",
    "va",
    "v.a.",
    "v/a",
    "compilation",
    "compilations",
    "сборник",
    "сборники",
    "разные исполнители",
}


@dataclass
class PathSays:
    """What a file's folders and name say about it (see from_path)."""

    title: str
    artist: str | None = None
    album: str | None = None
    album_artist: str | None = None
    year: int | None = None
    track_no: int | None = None
    disc_no: int | None = None


def _name(text: str) -> str:
    """A folder or file name as a name: underscores standing for spaces ("Hurt_In_Lane")
    are spaces again, spaces collapsed."""
    if " " not in text.strip():
        text = text.replace("_", " ")
    return " ".join(text.split())


def _names(text: str | None) -> set[str]:
    """Everyone a credit names ("A feat. B" -> a, b), to compare."""
    if not text:
        return set()
    main, featured = split_featured(text)
    return {name_key(n) for n in (main, *featured) if n}


def _numbered(text: str) -> tuple[int | None, int | None, str]:
    """ "1-02 Title" -> (1, 2, "Title"): the disc, the track and the rest of a file name."""
    match = _NUMBER.match(text)
    if match is None:
        return None, None, text
    disc = int(match["disc"]) if match["disc"] else None
    track = int(match["track"] or match["number"] or match["padded"])
    return disc or None, track or None, text[match.end() :]


def _is_note(text: str) -> bool:
    words = [w for w in re.split(r"[\s,;+]+", text) if w]
    return bool(words) and all(_NOTE.fullmatch(w) for w in words)


@dataclass
class _Folder:
    album: str
    year: int | None = None
    # An artist the name gives for certain ("Artist - 2018 - Album").
    artist: str | None = None
    # Its parts around " - ", which may be the artist and the album ("Artist - Album").
    split: tuple[str, str] | None = None


def _album_folder(text: str) -> _Folder:
    """ "2018 - Fake Truth [EP]" -> Fake Truth, 2018."""
    year = None
    # Notes and a year in brackets at the end: "Album (2018) [FLAC]".
    while (match := _BRACKETS_LAST.search(text)) and match.start() > 0:
        inner = match["inner"].strip()
        if year is None and re.fullmatch(_YEAR, inner):
            year = int(inner)
        elif not _is_note(inner):
            break
        text = text[: match.start()]
    if match := _ARTIST_YEAR.fullmatch(text):
        return _Folder(match["rest"], year or int(match["year"]), match["artist"])
    if (match := _YEAR_FIRST.fullmatch(text)) or (match := _YEAR_LAST.fullmatch(text)):
        year, text = year or int(match["year"]), match["rest"]
    parts = _DASH.split(text, maxsplit=1)
    return _Folder(text, year, split=(parts[0], parts[1]) if len(parts) == 2 else None)


def from_path(place: PurePosixPath, artist: str | None = None) -> PathSays:
    """What the folders and name of a file, `place` inside the library, say about it: music
    kept without tags is still kept in order, "Artist/2018 - Album [EP]/01 - Artist -
    Title.mp3". `artist`: the one the file's tags name, if any.

    The folder holding the file is its album's (a disc's folder, "CD1", is passed over), the
    one above it its artist's. A name with " - " starts with the artist when that matches
    the artist known from elsewhere; with none known, a file's name is read as "Artist -
    Title" and a folder's as "Artist - Album"."""
    *folders, file = (_name(part) for part in place.parts)
    disc = None
    if folders and (match := _DISC.match(folders[-1])):
        disc = int(match["disc"]) or None
        folders.pop()
    artist_folder = folders[-2] if len(folders) >= 2 else None
    various = artist_folder is not None and name_key(artist_folder) in _VARIOUS
    if various:
        artist_folder = None
    folder = _album_folder(folders[-1]) if folders else None

    file_disc, track_no, rest = _numbered(PurePosixPath(file).stem)
    parts = _DASH.split(rest, maxsplit=1)
    file_split = (parts[0], parts[1]) if len(parts) == 2 else None

    known = _names(artist) | _names(artist_folder)
    album = folder.album if folder else None
    folder_artist = folder.artist if folder else None
    if folder and folder.split:
        left, right = folder.split
        file_left = file_split[0] if file_split else None
        if _names(left) & (known | _names(file_left)) or (
            not known and not various and file_left is None
        ):
            folder_artist, album = left, right
    known |= _names(folder_artist)

    title, file_artist = rest, None
    if file_split:
        left, right = file_split
        if _names(left) & known or not known:
            file_artist, title = left, right
            if track_no is None:
                file_disc, track_no, title = _numbered(title)
    track_artist = file_artist or artist_folder or folder_artist
    album_artist = artist_folder or folder_artist
    if various:
        album_artist = VARIOUS_ARTISTS
    elif album_artist is None and track_artist:
        album_artist = split_featured(track_artist)[0]
    return PathSays(
        title=title,
        artist=track_artist,
        album=album or None,
        album_artist=album_artist,
        year=folder.year if folder else None,
        track_no=track_no,
        disc_no=disc or file_disc,
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
