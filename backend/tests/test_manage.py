"""Admins managing the library: the changes go into the files, and a scan afterwards finds
nothing to change."""

import errno
import time
from pathlib import Path

import httpx
from sqlalchemy.pool import NullPool

from app.config import Settings
from app.db import make_engine, make_sessionmaker
from app.library import files, manage
from app.library.tags import read_tags
from app.main import create_app
from tests.conftest import png_bytes


async def scan(client, admin, run_jobs) -> dict:
    assert (await client.post("/library/scan", headers=admin)).status_code == 202
    await run_jobs()
    return (await client.get("/library/scan", headers=admin)).json()["result"]


async def albums(client, headers) -> dict[str, dict]:
    items = (await client.get("/albums?limit=100", headers=headers)).json()["items"]
    return {a["title"]: a for a in items}


async def album(client, headers, album_id: str) -> dict:
    return (await client.get(f"/albums/{album_id}", headers=headers)).json()


def unchanged(result: dict) -> bool:
    return result["added"] == result["updated"] == result["moved"] == result["removed"] == 0


async def test_an_album_renamed_in_its_files_keeps_its_id_and_likes(
    client, admin, user, make_audio, run_jobs, settings
):
    one = make_audio("Night/01.mp3", title="One", artist="Katatonia", album="Night", track=1)
    two = make_audio("Night/02.flac", title="Two", artist="Katatonia", album="Night", track=2)
    make_audio("Other/01.mp3", title="Else", artist="Katatonia", album="Other", year=2001)
    await scan(client, admin, run_jobs)
    night = (await albums(client, admin))["Night"]
    await client.put(f"/me/likes/albums/{night['id']}", headers=user)

    patch = {"title": "Night Is the New Day", "year": 2009, "genre": "Doom"}
    resp = await client.patch(f"/albums/{night['id']}", json=patch, headers=admin)
    assert resp.status_code == 200, resp.text
    renamed = resp.json()
    assert renamed["id"] == night["id"]
    assert (renamed["title"], renamed["year"], renamed["genre"]) == (
        "Night Is the New Day",
        2009,
        "Doom",
    )
    assert renamed["liked"] is False  # the admin's view; the listener's like stays:
    assert (await album(client, user, night["id"]))["liked"] is True
    for path in (one, two):
        tags = read_tags(path)
        assert (tags.album, tags.year, tags.genre) == ("Night Is the New Day", 2009, "Doom")
    assert unchanged(await scan(client, admin, run_jobs))
    assert (await album(client, admin, night["id"]))["title"] == "Night Is the New Day"

    # Another artist, a cleared year.
    resp = await client.patch(
        f"/albums/{night['id']}",
        json={"artist": "Katatonia & Friends", "year": None},
        headers=admin,
    )
    assert resp.json()["artist"]["name"] == "Katatonia & Friends" and resp.json()["year"] is None
    assert read_tags(one).album_artist == "Katatonia & Friends" and read_tags(one).year is None
    assert read_tags(one).artists == ["Katatonia"]  # the track's own artist stays

    # The title and artist of another album: merged into it, with the likes.
    resp = await client.patch(
        f"/albums/{night['id']}",
        json={"title": "Other", "artist": "Katatonia"},
        headers=admin,
    )
    merged = resp.json()
    assert merged["id"] != night["id"] and merged["title"] == "Other"
    detail = await album(client, user, merged["id"])
    # In order: by number, the one without last.
    assert [t["title"] for t in detail["tracks"]] == ["One", "Two", "Else"]
    assert detail["liked"] is True
    assert (await client.get(f"/albums/{night['id']}", headers=admin)).status_code == 404
    assert unchanged(await scan(client, admin, run_jobs))


async def test_a_track_edited_in_its_file(client, admin, make_audio, run_jobs):
    path = make_audio("a/1.opus", title="Song", artist="A", album="L", track=1, disc=1)
    await scan(client, admin, run_jobs)
    (track,) = (await client.get("/tracks", headers=admin)).json()["items"]

    resp = await client.patch(
        f"/tracks/{track['id']}",
        json={
            "title": "Song (Live)",
            "artists": ["A", " B, Jr. ", "a"],
            "track_no": 7,
            "disc_no": None,
        },
        headers=admin,
    )
    assert resp.status_code == 200, resp.text
    edited = resp.json()
    assert edited["id"] == track["id"] and edited["title"] == "Song (Live)"
    assert [a["name"] for a in edited["artists"]] == ["A", "B, Jr."]
    assert (edited["track_no"], edited["disc_no"]) == (7, None)
    tags = read_tags(path)
    assert (tags.title, tags.artists, tags.track_no, tags.disc_no) == (
        "Song (Live)",
        ["A", "B, Jr."],
        7,
        None,
    )
    assert unchanged(await scan(client, admin, run_jobs))

    bad = await client.patch(f"/tracks/{track['id']}", json={"artists": []}, headers=admin)
    assert bad.status_code == 422
    blank = await client.patch(f"/tracks/{track['id']}", json={"title": "  "}, headers=admin)
    assert blank.status_code == 422


async def test_tracks_moved_into_another_album_go_to_its_folder(
    client, admin, user, make_audio, run_jobs, settings
):
    lib: Path = settings.library_path
    stray = make_audio("Loose/song.flac", title="Stray", artist="A", album="Loose", cover=(9, 9, 9))
    stray.with_suffix(".lrc").write_text("[00:01.00]words", encoding="utf-8")
    make_audio("Home/01.mp3", title="First", artist="A", album="Home", track=1, year=2020)
    (lib / "Home" / "cover.png").write_bytes(png_bytes((200, 0, 0)))
    await scan(client, admin, run_jobs)
    found = await albums(client, admin)
    tracks = {t["title"]: t for t in (await client.get("/tracks", headers=admin)).json()["items"]}
    await client.put(f"/me/likes/tracks/{tracks['Stray']['id']}", headers=user)

    resp = await client.post(
        "/tracks/move",
        json={"track_ids": [tracks["Stray"]["id"]], "album_id": found["Home"]["id"]},
        headers=admin,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == found["Home"]["id"]
    detail = await album(client, user, found["Home"]["id"])
    assert [(t["title"], t["liked"]) for t in detail["tracks"]] == [
        ("First", False),
        ("Stray", True),
    ]
    assert detail["tracks"][1]["id"] == tracks["Stray"]["id"]
    # The file and its lyrics are in the album's folder, tagged as its own; the folder it
    # left had nothing else but its cover, and is gone.
    moved = lib / "Home" / "song.flac"
    assert moved.is_file() and moved.with_suffix(".lrc").is_file()
    assert not (lib / "Loose").exists()
    tags = read_tags(moved)
    assert (tags.album, tags.album_artist, tags.year) == ("Home", "A", 2020)
    assert "Loose" not in await albums(client, admin)
    lyrics = await client.get(f"/tracks/{tracks['Stray']['id']}/lyrics", headers=user)
    assert lyrics.json()["plain"] == "words"
    assert unchanged(await scan(client, admin, run_jobs))

    # Into a new album: a folder of its own.
    resp = await client.post(
        "/tracks/move",
        json={
            "track_ids": [tracks["Stray"]["id"], tracks["First"]["id"]],
            "new_album": {"title": "Fresh / Start", "artist": "B"},
        },
        headers=admin,
    )
    fresh = resp.json()
    assert (fresh["title"], fresh["artist"]["name"]) == ("Fresh / Start", "B")
    assert sorted(p.name for p in (lib / "B" / "Fresh _ Start").iterdir()) == [
        "01.mp3",
        "song.flac",
        "song.lrc",
    ]
    # Home kept a cover.png but no music: gone too.
    assert not (lib / "Home").exists()
    assert unchanged(await scan(client, admin, run_jobs))

    unknown = await client.post(
        "/tracks/move",
        json={"track_ids": ["00000000-0000-0000-0000-000000000000"], "album_id": fresh["id"]},
        headers=admin,
    )
    assert unknown.json()["code"] == "unknown_tracks"
    both = await client.post(
        "/tracks/move",
        json={"track_ids": [tracks["Stray"]["id"]], "album_id": fresh["id"], "new_album": None},
        headers=admin,
    )
    assert both.status_code == 200
    neither = await client.post(
        "/tracks/move", json={"track_ids": [tracks["Stray"]["id"]]}, headers=admin
    )
    assert neither.status_code == 422


async def test_deleting_tracks_and_albums(client, admin, make_audio, run_jobs, settings):
    lib: Path = settings.library_path
    one = make_audio("Del/01.flac", title="One", artist="A", album="Del", track=1, cover=(1, 2, 3))
    two = make_audio("Del/02.flac", title="Two", artist="A", album="Del", track=2)
    one.with_suffix(".txt").write_text("words", encoding="utf-8")
    keep = make_audio("Keep/01.flac", title="Kept", artist="B", album="Keep")
    (keep.parent / "booklet.pdf").write_bytes(b"%PDF")
    await scan(client, admin, run_jobs)
    tracks = {t["title"]: t for t in (await client.get("/tracks", headers=admin)).json()["items"]}

    assert (await client.delete(f"/tracks/{tracks['One']['id']}", headers=admin)).status_code == 204
    assert not one.exists() and not one.with_suffix(".txt").exists() and two.exists()
    assert (await client.get(f"/tracks/{tracks['One']['id']}", headers=admin)).status_code == 404

    found = await albums(client, admin)
    resp = await client.delete(f"/albums/{found['Del']['id']}?tracks=delete", headers=admin)
    assert resp.status_code == 200 and resp.json() == []
    assert not (lib / "Del").exists()
    resp = await client.delete(f"/albums/{found['Keep']['id']}?tracks=delete", headers=admin)
    # A file that isn't music keeps its folder.
    assert sorted(p.name for p in (lib / "Keep").iterdir()) == ["booklet.pdf"]
    assert await albums(client, admin) == {}
    assert unchanged(await scan(client, admin, run_jobs))

    missing = await client.delete(f"/albums/{found['Del']['id']}?tracks=delete", headers=admin)
    assert missing.json()["code"] == "album_not_found"
    no_choice = await client.delete(f"/albums/{found['Del']['id']}", headers=admin)
    assert no_choice.status_code == 422


async def test_an_album_deleted_into_singles(client, admin, make_audio, run_jobs, settings):
    make_audio(
        "Al/01.flac", title="Intro", artist="A", album="Al", track=1, disc=1, cover=(9, 0, 0)
    )
    make_audio("Al/02.flac", title="Hit", artist="A feat. B", album="Al", track=2, disc=1)
    await scan(client, admin, run_jobs)
    found = await albums(client, admin)
    tracks = {t["title"]: t for t in (await client.get("/tracks", headers=admin)).json()["items"]}

    resp = await client.delete(f"/albums/{found['Al']['id']}?tracks=singles", headers=admin)
    assert resp.status_code == 200, resp.text
    singles = {a["title"]: a for a in resp.json()}
    assert set(singles) == {"Intro", "Hit"}
    assert {a["artist"]["name"] for a in singles.values()} == {"A"}
    # Their art: the folder's cover, which they still share.
    assert singles["Intro"]["cover_id"] == singles["Hit"]["cover_id"] == found["Al"]["cover_id"]
    hit = (await album(client, admin, singles["Hit"]["id"]))["tracks"]
    assert hit[0]["id"] == tracks["Hit"]["id"] and hit[0]["track_no"] is None
    assert [a["name"] for a in hit[0]["artists"]] == ["A", "B"]
    assert (await client.get(f"/albums/{found['Al']['id']}", headers=admin)).status_code == 404
    assert (settings.library_path / "Al" / "02.flac").is_file()
    assert unchanged(await scan(client, admin, run_jobs))


async def test_uploading_into_an_album(client, admin, make_audio, run_jobs, settings, tmp_path):
    make_audio("Al/01.mp3", title="One", artist="A", album="Al", track=1, year=2020, genre="Rock")
    make_audio("Al/02.mp3", title="Two", artist="A", album="Al", track=2)
    await scan(client, admin, run_jobs)
    al = (await albums(client, admin))["Al"]

    # A file with tags of its own: no album, no number, no artist.
    outside = tmp_path / "outside"
    upload = make_audio("../outside/new.ogg", title="Three", artist="", album="")
    url = f"/albums/{al['id']}/tracks"
    resp = await client.post(
        url, files={"file": ("New Song.ogg", upload.read_bytes())}, headers=admin
    )
    assert resp.status_code == 201, resp.text
    added = resp.json()
    assert added["duplicate"] is False
    track = added["track"]
    assert (track["title"], track["track_no"], track["album"]["id"]) == ("Three", 3, al["id"])
    assert track["artist"]["name"] == "A"
    saved = settings.library_path / "Al" / "New Song.ogg"
    tags = read_tags(saved)
    assert (tags.album, tags.album_artist, tags.year, tags.genre) == ("Al", "A", 2020, "Rock")
    await run_jobs()  # its transcodes and lyrics
    assert unchanged(await scan(client, admin, run_jobs))

    # The same file again: nothing saved.
    again = await client.post(url, files={"file": ("copy.ogg", saved.read_bytes())}, headers=admin)
    assert again.json()["duplicate"] is True and again.json()["track"]["id"] == track["id"]
    assert not (settings.library_path / "Al" / "copy.ogg").exists()

    wav = await client.post(url, files={"file": ("x.wav", b"RIFF")}, headers=admin)
    assert wav.json()["code"] == "tags_not_writable"
    text = await client.post(url, files={"file": ("x.txt", b"hi")}, headers=admin)
    assert text.json()["code"] == "not_an_audio_file"
    broken = await client.post(url, files={"file": ("x.mp3", b"not audio")}, headers=admin)
    assert broken.json()["code"] == "not_an_audio_file"
    assert sorted(p.name for p in (settings.library_path / "Al").iterdir()) == [
        "01.mp3",
        "02.mp3",
        "New Song.ogg",
    ]
    assert outside.is_dir()


async def test_an_artist_renamed_everywhere_or_merged(
    client, admin, user, make_audio, run_jobs, settings
):
    hit = make_audio(
        "A/01.flac", title="Hit (feat. Old Name)", artist="Main feat. Old Name", album="A1"
    )
    own = make_audio("B/01.flac", title="Own", artist="Old Name", album="B1")
    make_audio("C/01.flac", title="Other", artist="Someone", album="B1", album_artist="Someone")
    await scan(client, admin, run_jobs)
    artists = {a["name"]: a for a in (await client.get("/artists", headers=admin)).json()["items"]}
    old = artists["Old Name"]
    await client.put(f"/me/likes/artists/{old['id']}", headers=user)

    resp = await client.patch(f"/artists/{old['id']}", json={"name": "New Name"}, headers=admin)
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == old["id"] and resp.json()["name"] == "New Name"
    tags = read_tags(hit)
    assert (tags.title, tags.artists) == ("Hit (feat. New Name)", ["Main", "New Name"])
    assert (read_tags(own).artists, read_tags(own).album_artist) == (["New Name"], "New Name")
    assert unchanged(await scan(client, admin, run_jobs))

    # The name of another artist: merged into them, their albums of the same title too.
    someone = artists["Someone"]
    resp = await client.patch(f"/artists/{old['id']}", json={"name": "someone"}, headers=admin)
    assert resp.json()["id"] == someone["id"] and resp.json()["name"] == "Someone"
    merged = (await client.get(f"/artists/{someone['id']}", headers=user)).json()
    assert merged["liked"] is True
    assert [a["title"] for a in merged["albums"]] == ["B1"]
    b1 = await album(client, admin, merged["albums"][0]["id"])
    assert sorted(t["title"] for t in b1["tracks"]) == ["Other", "Own"]
    assert (await client.get(f"/artists/{old['id']}", headers=admin)).status_code == 404
    assert unchanged(await scan(client, admin, run_jobs))


async def test_files_that_cant_be_changed(client, admin, user, make_audio, run_jobs, monkeypatch):
    make_audio("W/01.wav", title="Wave", artist="A", album="W")
    first = make_audio("M/01.mp3", title="One", artist="A", album="M", track=1)
    make_audio("M/02.mp3", title="Two", artist="A", album="M", track=2)
    await scan(client, admin, run_jobs)
    found = await albums(client, admin)

    wav = await client.patch(
        f"/albums/{found['Unknown Album']['id']}", json={"title": "X"}, headers=admin
    )
    assert (wav.status_code, wav.json()["code"]) == (415, "tags_not_writable")

    # The second file can't be written: the first one's change is in the library anyway.
    real = manage.write_tags
    calls = []

    def flaky(path, values):
        calls.append(path)
        if len(calls) == 2:
            raise PermissionError(errno.EACCES, "Permission denied")
        real(path, values)

    monkeypatch.setattr(manage, "write_tags", flaky)
    resp = await client.patch(f"/albums/{found['M']['id']}", json={"title": "N"}, headers=admin)
    assert (resp.status_code, resp.json()["code"]) == (503, "library_not_writable")
    assert read_tags(first).album == "N"
    now = await albums(client, admin)
    assert [t["title"] for t in (await album(client, admin, now["N"]["id"]))["tracks"]] == ["One"]
    assert [t["title"] for t in (await album(client, admin, now["M"]["id"]))["tracks"]] == ["Two"]

    assert (
        await client.patch(f"/albums/{now['M']['id']}", json={"title": "Y"}, headers=user)
    ).status_code == 403
    tracks = (await client.get("/tracks", headers=admin)).json()["items"]
    assert (await client.delete(f"/tracks/{tracks[0]['id']}", headers=user)).status_code == 403


async def test_tidying_folders_that_fails_undoes_nothing(
    client, admin, make_audio, run_jobs, settings, monkeypatch
):
    make_audio("Al/01.flac", title="One", artist="A", album="Al")
    await scan(client, admin, run_jobs)
    al = (await albums(client, admin))["Al"]
    upload = make_audio("../up.flac", title="Up", artist="A", album="Al").read_bytes()
    resp = await client.post(
        f"/albums/{al['id']}/tracks", files={"file": ("up.flac", upload)}, headers=admin
    )
    track = resp.json()["track"]

    def refuse(self):
        raise PermissionError(13, "Permission denied", str(self))

    monkeypatch.setattr(Path, "rmdir", refuse)
    gone = await client.delete(f"/albums/{al['id']}?tracks=delete", headers=admin)
    assert gone.status_code == 200, gone.text
    assert (await client.get(f"/tracks/{track['id']}", headers=admin)).status_code == 404
    assert not (settings.library_path / "Al" / "01.flac").exists()


def test_tidying_keeps_the_uploads_folder(tmp_path):
    root = tmp_path / "library"
    album = root / "uploads" / "Artist" / "Album"
    album.mkdir(parents=True)
    (album / "cover.jpg").write_bytes(b"jpg")
    files.prune(album, root, keep=[root / "uploads"])
    assert sorted(p.name for p in root.rglob("*")) == ["uploads"]


async def test_long_edits_hold_no_transaction_while_files_are_written(
    client, admin, make_audio, run_jobs, settings, monkeypatch
):
    """The database closes a connection idle in a transaction (30 s in production): writing
    the tags of many files must not keep one open meanwhile."""
    make_audio("Al/01.flac", title="One", artist="A", album="Al", genre="Rock")
    make_audio("Al/02.flac", title="Two", artist="A", album="Al", genre="Rock")
    await scan(client, admin, run_jobs)
    al = (await albums(client, admin))["Al"]

    engine = make_engine(
        Settings().database_url, settings.db_schema, statement_timeout=1, poolclass=NullPool
    )
    app = create_app(settings)
    app.state.sessionmaker = make_sessionmaker(engine)
    write_tags = manage.write_tags

    def slow(path, values):
        time.sleep(0.7)  # two of them: longer than the database lets a transaction idle
        write_tags(path, values)

    monkeypatch.setattr(manage, "write_tags", slow)
    monkeypatch.setattr(manage, "REIMPORT_BATCH", 1)
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://t/api/v1") as c:
            resp = await c.patch(f"/albums/{al['id']}", json={"title": "Renamed"}, headers=admin)
            assert resp.status_code == 200, resp.text
            genre = await c.patch(
                "/genres", params={"genre": "Rock"}, json={"name": "Jazz"}, headers=admin
            )
            assert genre.status_code == 200, genre.text
    finally:
        await engine.dispose()
    assert unchanged(await scan(client, admin, run_jobs))
    renamed = (await albums(client, admin))["Renamed"]
    assert renamed["id"] == al["id"] and renamed["genre"] == "Jazz"


async def test_a_genre_change_imports_again_only_files_changed_on_the_disk(
    client, admin, make_audio, run_jobs, settings, monkeypatch
):
    make_audio("Al/01.flac", title="One", artist="A", album="Al", genre="Rock")
    changed = make_audio("Al/02.flac", title="Two", artist="A", album="Al", genre="Rock")
    await scan(client, admin, run_jobs)
    # Retitled by another program since the last scan.
    make_audio("Al/02.flac", title="Two (live)", artist="A", album="Al", genre="Rock")
    assert changed.exists()
    imported = []
    import_file = manage.import_file

    async def counted(session, library, rel):
        imported.append(rel)
        return await import_file(session, library, rel)

    monkeypatch.setattr(manage, "import_file", counted)
    rock = {"genre": "Rock"}
    resp = await client.patch("/genres", params=rock, json={"name": "Jazz"}, headers=admin)
    assert resp.status_code == 200, resp.text
    assert imported == ["Al/02.flac"]
    titles = {t["title"] for t in (await client.get("/tracks", headers=admin)).json()["items"]}
    assert titles == {"One", "Two (live)"}
    assert unchanged(await scan(client, admin, run_jobs))
