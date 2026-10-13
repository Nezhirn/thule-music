"""Tags as real files have them: legacy encodings, junk values, featured artists."""

import subprocess
from pathlib import Path

import pytest
from mutagen.flac import FLAC
from mutagen.id3 import ID3, TALB, TCON, TIT2, TPE1, TPOS, TRCK, Encoding

from app.library.tags import (
    MAX_NAME,
    UNKNOWN_ARTIST,
    VARIOUS_ARTISTS,
    read_tags,
    split_featured,
)


def blank(path: Path, **metadata: str) -> Path:
    """A one-second file with just these tags (written by ffmpeg)."""
    tags = [arg for key, value in metadata.items() for arg in ("-metadata", f"{key}={value}")]
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc"]
        + ["-t", "1", "-map_metadata", "-1", *tags, str(path)],
        check=True,
    )
    return path


def id3(path: Path, *frames, version: int = 3) -> Path:
    tags = ID3()
    for frame in frames:
        tags.add(frame)
    tags.save(blank(path), v2_version=version)
    return path


def latin1(text: str) -> str:
    """Text as an old Windows tagger stored it in a frame declared Latin-1: cp1251 bytes."""
    return text.encode("cp1251").decode("latin-1")


def test_cp1251_declared_latin1_is_read_as_cyrillic(tmp_path):
    path = id3(
        tmp_path / "a.mp3",
        TIT2(encoding=Encoding.LATIN1, text=latin1("Песня про ёжика")),
        TPE1(encoding=Encoding.LATIN1, text=latin1("Кино-Кот")),
        TALB(encoding=Encoding.LATIN1, text=latin1("Зелёный альбом")),
    )
    tags = read_tags(path)
    assert (tags.title, tags.artist, tags.album) == (
        "Песня про ёжика",
        "Кино-Кот",
        "Зелёный альбом",
    )


@pytest.mark.parametrize("text", ["Café Del Mar", "Größe", "Sigur Rós - Ágætis byrjun"])
def test_real_latin1_text_stays(tmp_path, text):
    path = id3(tmp_path / "a.mp3", TIT2(encoding=Encoding.LATIN1, text=text))
    assert read_tags(path).title == text


def test_flac_comments_that_are_not_utf8_are_read_as_cp1251(tmp_path):
    # Placeholders as long as the cp1251 bytes that replace them.
    path = blank(tmp_path / "a.flac", title="QQQQQ", artist="Ёлка", album="ZZZZZZZ 1998")
    data = path.read_bytes()
    data = data.replace(b"QQQQQ", "Песня".encode("cp1251"))
    data = data.replace(b"ZZZZZZZ", "Альбомы".encode("cp1251"))
    path.write_bytes(data)
    tags = read_tags(path)
    assert (tags.title, tags.artist, tags.album) == ("Песня", "Ёлка", "Альбомы 1998")


def test_junk_values(tmp_path):
    path = id3(
        tmp_path / "05 junk.mp3",
        TIT2(encoding=Encoding.UTF8, text=["   ", "Second title frame"]),
        TPE1(encoding=Encoding.UTF8, text="\t\r\n"),
        TALB(encoding=Encoding.UTF8, text="Очень длинное название " * 40),
        TRCK(encoding=Encoding.UTF8, text="abc/xyz"),
        TPOS(encoding=Encoding.UTF8, text="0/0"),
        TCON(encoding=Encoding.UTF8, text="(999)"),
        version=4,  # ID3v2.3 has no multiple values: it would join the titles with "/"
    )
    tags = read_tags(path)
    assert tags.title == "Second title frame"
    assert tags.artists == [UNKNOWN_ARTIST]
    assert len(tags.album) <= MAX_NAME and tags.album.startswith("Очень длинное")
    assert (tags.track_no, tags.disc_no, tags.genre) == (None, None, None)


@pytest.mark.parametrize(
    ("date", "year"),
    [("2009-05-01", 2009), ("1998", 1998), ("20x4", None), ("98", None), ("", None)],
)
def test_year(tmp_path, date, year):
    assert read_tags(blank(tmp_path / "a.flac", date=date)).year == year


def test_whitespace_in_names_is_collapsed(tmp_path):
    path = blank(tmp_path / "a.flac", title="  Two\tSpaces  ", artist="A\nB")
    tags = read_tags(path)
    assert (tags.title, tags.artist) == ("Two Spaces", "A B")


@pytest.mark.parametrize(
    ("text", "main", "featured"),
    [
        ("Северный Ветер feat. Анна Лунина", "Северный Ветер", ["Анна Лунина"]),
        ("Neon Harbor ft. Mila & Roy", "Neon Harbor", ["Mila", "Roy"]),
        ("Daft Punk featuring Pharrell Williams", "Daft Punk", ["Pharrell Williams"]),
        ("A (feat. B, C)", "A", ["B", "C"]),
        ("Signal Lost [feat. Mila]", "Signal Lost", ["Mila"]),
        ("Simon & Garfunkel", "Simon & Garfunkel", []),
        ("Ft. Lauderdale Strings", "Ft. Lauderdale Strings", []),
        ("Theft", "Theft", []),
    ],
)
def test_split_featured(text, main, featured):
    assert split_featured(text) == (main, featured)


def test_everyone_credited_once_main_artist_first(tmp_path):
    path = blank(tmp_path / "a.flac", title="Ночь (feat. Анна Лунина)")
    audio = FLAC(path)
    audio["artist"] = ["Северный Ветер", "Мила feat. Анна Лунина"]
    audio.save()
    tags = read_tags(path)
    assert tags.artists == ["Северный Ветер", "Мила", "Анна Лунина"]
    assert tags.title == "Ночь (feat. Анна Лунина)"
    assert tags.album_artist == "Северный Ветер"


def test_album_artist(tmp_path):
    featured = blank(tmp_path / "a.flac", artist="B", album_artist="A feat. B")
    assert read_tags(featured).album_artist == "A"
    compilation = blank(tmp_path / "b.flac", artist="B", compilation="1")
    assert read_tags(compilation).album_artist == VARIOUS_ARTISTS
