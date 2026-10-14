"""Writing tags into the user's files: never leaves a file half written."""

import os
import random
import signal
import subprocess
import sys
import time
from pathlib import Path

import mutagen
import pytest

from app.library import importer
from app.library.importer import _walk
from app.library.tagwrite import is_leftover_copy, write_tags


def make(path: Path, codec: str, seconds: int = 60) -> Path:
    """Noise: it doesn't compress, so the file is as big as real music."""
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi"]
        + ["-i", f"anoisesrc=duration={seconds}:color=pink", "-c:a", codec, str(path)],
        check=True,
    )
    return path


def audio_md5(path: Path) -> str:
    """Of the decoded audio: the tags aside, the music itself."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path), "-map", "0:a"]
        + ["-f", "md5", "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout.strip()


@pytest.mark.parametrize("name,codec", [("a.mp3", "libmp3lame"), ("a.flac", "flac")])
def test_tags_go_into_a_copy_that_replaces_the_file(tmp_path, name, codec):
    path = make(tmp_path / name, codec, seconds=5)
    os.chmod(path, 0o640)
    before = path.stat()
    write_tags(path, {"title": "x" * 5000, "genre": "Rock"})
    after = path.stat()
    assert after.st_ino != before.st_ino  # replaced, not rewritten in place
    assert (after.st_mode, after.st_uid, after.st_gid) == (
        before.st_mode,
        before.st_uid,
        before.st_gid,
    )
    assert mutagen.File(path, easy=True)["genre"] == ["Rock"]
    assert sorted(p.name for p in tmp_path.iterdir()) == [name]  # no copy left


def test_a_file_with_hard_links_is_written_in_place(tmp_path):
    path = make(tmp_path / "a.flac", "flac", seconds=3)
    other = tmp_path / "seeding.flac"
    os.link(path, other)
    write_tags(path, {"title": "Shared"})
    assert path.stat().st_ino == other.stat().st_ino
    assert mutagen.File(other, easy=True)["title"] == ["Shared"]


def test_a_write_through_a_link_changes_the_file_it_points_to(tmp_path):
    real = make(tmp_path / "real.mp3", "libmp3lame", seconds=3)
    link = tmp_path / "link.mp3"
    link.symlink_to(real)
    write_tags(link, {"title": "Through"})
    assert link.is_symlink()
    assert mutagen.File(real, easy=True)["title"] == ["Through"]


@pytest.mark.parametrize("name,codec", [("a.mp3", "libmp3lame"), ("a.flac", "flac")])
def test_killing_a_write_never_breaks_the_file(tmp_path, name, codec):
    path = make(tmp_path / name, codec, seconds=60)
    music = audio_md5(path)
    writer = (
        "import sys, itertools\n"
        "from pathlib import Path\n"
        "from app.library.tagwrite import write_tags\n"
        "print('ready', flush=True)\n"
        "for n in itertools.count():\n"
        # Each tag bigger than the last: no room left before the audio, which moves along.
        "    write_tags(Path(sys.argv[1]), {'title': 'x' * (n + 1) * 20000})\n"
    )
    rng = random.Random(1)
    for _ in range(8):
        proc = subprocess.Popen(
            [sys.executable, "-c", writer, str(path)],
            cwd=Path(__file__).resolve().parents[1],
            stdout=subprocess.PIPE,
        )
        assert proc.stdout is not None and proc.stdout.readline() == b"ready\n"
        time.sleep(rng.uniform(0.05, 0.4))
        proc.send_signal(signal.SIGKILL)
        proc.wait()
        assert mutagen.File(path, easy=True) is not None
        assert audio_md5(path) == music


def test_scans_tell_copies_of_writes_cut_short_long_ago(tmp_path, monkeypatch):
    root = tmp_path / "library"
    (root / "A").mkdir(parents=True)
    copy = root / "A" / ".thule-0123456789ab.flac"
    copy.touch()
    (root / "A" / ".hidden.flac").touch()
    assert is_leftover_copy(copy.name) and not is_leftover_copy(".hidden.flac")
    assert _walk(root).leftovers == []  # just made: maybe a write going on
    monkeypatch.setattr(importer, "LEFTOVER_AGE", -1)
    assert _walk(root).leftovers == [copy]
