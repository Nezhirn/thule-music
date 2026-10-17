import os
import shutil

import pytest

from app.jobs.queue import enqueue
from app.library import importer
from app.library.importer import _walk, resolve_in_library
from tests.conftest import png_bytes


async def scan(client, admin, run_jobs) -> None:
    assert (await client.post("/library/scan", headers=admin)).status_code == 202
    await run_jobs()


async def test_scan_imports_tags_covers_and_groups_albums(
    client, admin, make_audio, run_jobs, settings
):
    make_audio(
        "Katatonia/Night/01.mp3",
        title="A Line in the Dust",
        artist="Katatonia",
        album="Night",
        track=1,
        year=2020,
        cover=(200, 40, 40),
    )
    make_audio(
        "Katatonia/Night/02.mp3",
        title="Second",
        artist="katatonia ",
        album="Night",
        track=2,
        year=2020,
        cover=(200, 40, 40),
    )
    make_audio(
        "Alcest/Lune/01.flac",
        title="Écailles de Lune",
        artist="Alcest",
        album="Écailles de Lune",
        track=1,
        cover=(10, 10, 90),
    )
    await scan(client, admin, run_jobs)

    # "Katatonia" and "katatonia " are merged into one artist.
    artists = (await client.get("/artists", headers=admin)).json()
    assert [a["name"].strip().casefold() for a in artists["items"]] == ["alcest", "katatonia"]
    assert all(a["album_count"] == 1 and a["cover_id"] for a in artists["items"])

    albums = (await client.get("/albums?sort=title", headers=admin)).json()["items"]
    night = next(a for a in albums if a["title"] == "Night")
    assert night["year"] == 2020
    assert night["cover_palette"]["average"] == "#c82828"

    detail = (await client.get(f"/albums/{night['id']}", headers=admin)).json()
    assert [t["title"] for t in detail["tracks"]] == ["A Line in the Dust", "Second"]
    assert detail["duration_ms"] == pytest.approx(4000, abs=200)
    assert detail["tracks"][0]["codec"] == "mp3"

    # FLAC got its artwork from the folder's cover.png
    lune = next(a for a in albums if a["title"] == "Écailles de Lune")
    assert lune["cover_palette"]["average"] == "#0a0a5a"
    cover = await client.get(f"/covers/{lune['cover_id']}?size=64")
    assert cover.status_code == 200
    assert cover.headers["content-type"] == "image/jpeg"


async def test_compilation_keeps_album_artist_and_track_artist(client, admin, make_audio, run_jobs):
    make_audio("VA/01.mp3", title="One", artist="Amenra", album="Mix", album_artist="Various")
    make_audio("VA/02.mp3", title="Two", artist="Lustre", album="Mix", album_artist="Various")
    await scan(client, admin, run_jobs)

    albums = (await client.get("/albums", headers=admin)).json()["items"]
    assert len(albums) == 1 and albums[0]["artist"]["name"] == "Various"
    tracks = (await client.get(f"/albums/{albums[0]['id']}", headers=admin)).json()["tracks"]
    assert {t["artist"]["name"] for t in tracks} == {"Amenra", "Lustre"}
    assert {t["album_artist"]["name"] for t in tracks} == {"Various"}


async def test_rescan_removes_deleted_files_and_orphans(client, admin, make_audio, run_jobs):
    keep = make_audio("a/1.mp3", title="Keep", artist="A", album="X")
    gone = make_audio("b/1.mp3", title="Gone", artist="B", album="Y")
    await scan(client, admin, run_jobs)
    assert (await client.get("/tracks", headers=admin)).json()["total"] == 2

    gone.unlink()
    await scan(client, admin, run_jobs)
    tracks = (await client.get("/tracks", headers=admin)).json()
    assert [t["title"] for t in tracks["items"]] == ["Keep"]
    artists = (await client.get("/artists", headers=admin)).json()["items"]
    assert [a["name"] for a in artists] == ["A"]
    assert keep.exists()


async def test_moved_files_keep_track_and_user_data(client, admin, make_audio, run_jobs, settings):
    make_audio("Old/01.mp3", title="One", artist="A", album="X", track=1, cover=(9, 9, 9))
    make_audio("Old/02.mp3", title="Two", artist="A", album="X", track=2, cover=(9, 9, 9))
    await scan(client, admin, run_jobs)
    before = {t["title"]: t for t in (await client.get("/tracks", headers=admin)).json()["items"]}
    one = before["One"]["id"]
    await client.put(f"/me/likes/tracks/{one}", headers=admin)
    playlist = (await client.post("/playlists", json={"name": "P"}, headers=admin)).json()
    await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_ids": [one]}, headers=admin
    )
    await client.post("/me/plays", json={"track_id": one}, headers=admin)

    (settings.library_path / "Renamed").mkdir()
    (settings.library_path / "Old").rename(settings.library_path / "Renamed" / "X (2020)")
    await client.post("/library/scan", headers=admin)
    assert await run_jobs() == 1  # a plain move needs no re-import

    after = {t["title"]: t for t in (await client.get("/tracks", headers=admin)).json()["items"]}
    assert {t: v["id"] for t, v in after.items()} == {t: v["id"] for t, v in before.items()}
    assert after["One"]["album"]["id"] == before["One"]["album"]["id"]
    assert after["One"]["liked"]
    detail = (await client.get(f"/playlists/{playlist['id']}", headers=admin)).json()
    assert [i["track"]["id"] for i in detail["items"]] == [one]
    recent = (await client.get("/me/recent", headers=admin)).json()
    assert [r["track"]["id"] for r in recent] == [one]
    assert (
        await client.get(f"/tracks/{one}/stream?quality=original", headers=admin)
    ).status_code == 200


async def test_replaced_file_with_same_tags_keeps_track(client, admin, make_audio, run_jobs):
    old = make_audio("a/01.mp3", title="One", artist="A", album="X", track=1)
    await scan(client, admin, run_jobs)
    (track,) = (await client.get("/tracks", headers=admin)).json()["items"]
    await client.put(f"/me/likes/tracks/{track['id']}", headers=admin)

    # Re-encoded as FLAC in another folder: neither size nor mtime match, the tags do.
    old.unlink()
    make_audio("b/01.flac", title="One", artist="A", album="X", track=1)
    await scan(client, admin, run_jobs)

    (after,) = (await client.get("/tracks", headers=admin)).json()["items"]
    assert after["id"] == track["id"]
    assert after["codec"] == "flac"  # re-read from the new file
    assert after["liked"]


async def test_ambiguous_moves_are_imported_as_new_tracks(client, admin, make_audio, run_jobs):
    tags = {"title": "Dup", "artist": "A", "album": "X", "track": 1}
    first = make_audio("a/01.mp3", **tags)
    second = make_audio("b/01.mp3", **tags)
    await scan(client, admin, run_jobs)
    old_ids = {t["id"] for t in (await client.get("/tracks", headers=admin)).json()["items"]}

    first.unlink()
    second.unlink()
    make_audio("c/01.flac", **tags)
    make_audio("d/01.flac", **tags)
    await scan(client, admin, run_jobs)

    new_ids = {t["id"] for t in (await client.get("/tracks", headers=admin)).json()["items"]}
    assert len(new_ids) == 2 and not new_ids & old_ids


async def test_unchanged_files_are_not_reimported(client, admin, make_audio, run_jobs):
    make_audio("a/1.mp3", title="T", artist="A", album="X")
    await scan(client, admin, run_jobs)
    await client.post("/library/scan", headers=admin)
    assert await run_jobs() == 1  # just the scan job itself


async def test_upload_imports_file(client, admin, make_audio, run_jobs, tmp_path, settings):
    src = make_audio("../outside.mp3", title="Uploaded", artist="U", album="Up")
    with src.open("rb") as fh:
        resp = await client.post(
            "/library/uploads",
            files=[("files", ("../../evil name.mp3", fh, "audio/mpeg"))],
            headers=admin,
        )
    assert resp.status_code == 202, resp.text
    assert resp.json() == [{"path": "uploads/evil name.mp3", "duplicate": False}]
    await run_jobs()
    tracks = (await client.get("/tracks", headers=admin)).json()["items"]
    assert [t["title"] for t in tracks] == ["Uploaded"]


async def test_untagged_files_are_named_by_their_folders(client, admin, make_audio, run_jobs):
    for name in ("Hurt In Lane - Intro", "Hurt In Lane - Despair", "Hurt In Lane - W.T.E.E."):
        make_audio(f"Hurt In Lane/2018 - Fake Truth [EP]/{name}.mp3")
    make_audio("Hurt In Lane/2021 - Обитель/Hurt In Lane - Путь.mp3")
    await scan(client, admin, run_jobs)

    artists = (await client.get("/artists", headers=admin)).json()["items"]
    assert [(a["name"], a["album_count"]) for a in artists] == [("Hurt In Lane", 2)]
    albums = (await client.get("/albums?sort=year", headers=admin)).json()["items"]
    assert [(a["title"], a["year"], a["artist"]["name"]) for a in albums] == [
        ("Обитель", 2021, "Hurt In Lane"),
        ("Fake Truth", 2018, "Hurt In Lane"),
    ]
    detail = (await client.get(f"/albums/{albums[1]['id']}", headers=admin)).json()
    assert sorted(t["title"] for t in detail["tracks"]) == ["Despair", "Intro", "W.T.E.E."]


async def test_uploaded_folder_names_untagged_files(client, admin, make_audio, run_jobs):
    data = make_audio("../untagged.mp3").read_bytes()
    resp = await client.post(
        "/library/uploads",
        data={"folder": "Hurt In Lane/2018 - Fake Truth [EP]"},
        files=[("files", ("Hurt In Lane - Mob Law.mp3", data, "audio/mpeg"))],
        headers=admin,
    )
    assert resp.status_code == 202, resp.text
    await run_jobs()
    (track,) = (await client.get("/tracks", headers=admin)).json()["items"]
    assert (track["title"], track["artist"]["name"], track["album"]["title"]) == (
        "Mob Law",
        "Hurt In Lane",
        "Fake Truth",
    )


async def test_upload_keeps_existing_files(client, admin, make_audio, settings):
    first = make_audio("../one.mp3", title="One", artist="U", album="Up").read_bytes()
    second = make_audio("../two.mp3", title="Two", artist="U", album="Up").read_bytes()
    resp = await client.post(
        "/library/uploads",
        files=[("files", ("song.mp3", first, "audio/mpeg")), ("files", ("song.mp3", second))],
        headers=admin,
    )
    assert resp.status_code == 202, resp.text
    assert [r["path"] for r in resp.json()] == ["uploads/song.mp3", "uploads/song (1).mp3"]
    assert (settings.uploads_path / "song (1).mp3").read_bytes() == second


async def test_upload_rejects_non_audio(client, admin, settings):
    resp = await client.post(
        "/library/uploads",
        files=[
            ("files", ("ok.mp3", b"ID3", "audio/mpeg")),
            ("files", ("x.exe", b"MZ", "application/octet-stream")),
        ],
        headers=admin,
    )
    assert resp.status_code == 415
    # Nothing from the rejected batch is written.
    assert not settings.uploads_path.exists() or not any(settings.uploads_path.iterdir())


async def test_admin_endpoints_require_admin(client, user):
    assert (await client.post("/library/scan", headers=user)).status_code == 403
    assert (await client.get("/library/jobs", headers=user)).status_code == 403
    assert (await client.get("/library/jobs/summary", headers=user)).status_code == 403


async def test_jobs_listing(client, admin, make_audio, run_jobs):
    make_audio("a/1.mp3", title="T", artist="A", album="X")
    await scan(client, admin, run_jobs)
    jobs = (await client.get("/library/jobs", headers=admin)).json()["items"]
    assert {j["kind"] for j in jobs} == {
        "scan_library",
        "import_track",
        "transcode",
        "fetch_lyrics",
    }
    assert all(j["status"] == "done" for j in jobs)


async def test_jobs_summary(client, admin, make_audio, run_jobs):
    make_audio("a/1.mp3", title="T", artist="A", album="X")
    await client.post("/library/scan", headers=admin)
    summary = (await client.get("/library/jobs/summary", headers=admin)).json()
    assert summary["pending"] == 1 and summary["kinds"]["scan_library"]["queued"] == 1

    await run_jobs()
    summary = (await client.get("/library/jobs/summary", headers=admin)).json()
    assert summary["pending"] == 0 and summary["failed"] == 0
    assert summary["kinds"]["import_track"] == {"queued": 0, "running": 0, "done": 1, "failed": 0}

    later = await client.get("/library/jobs/summary?since=2999-01-01T00:00:00Z", headers=admin)
    assert later.json() == {"kinds": {}, "pending": 0, "failed": 0}


def test_resolve_in_library_blocks_traversal(tmp_path):
    for bad in ("../etc/passwd", "a/../../etc/passwd", "/etc/passwd"):
        with pytest.raises(ValueError):
            resolve_in_library(tmp_path, bad)
    assert resolve_in_library(tmp_path, "a/b.mp3") == tmp_path.resolve() / "a/b.mp3"


async def test_files_in_symlinked_folders_are_imported(
    client, admin, make_audio, run_jobs, settings, tmp_path
):
    (tmp_path / "elsewhere").mkdir()
    make_audio("../elsewhere/1.mp3", title="Linked", artist="A", album="X")
    (settings.library_path / "Linked").symlink_to(tmp_path / "elsewhere")
    await scan(client, admin, run_jobs)
    (track,) = (await client.get("/tracks", headers=admin)).json()["items"]
    assert track["title"] == "Linked"
    stream = await client.get(f"/tracks/{track['id']}/stream?quality=high", headers=admin)
    assert stream.status_code == 200 and stream.headers["x-thule-quality"] == "high"


def test_scan_follows_symlinks_but_not_cycles(tmp_path):
    root = tmp_path / "library"
    (root / "A").mkdir(parents=True)
    (root / "A" / "1.mp3").touch()
    (root / "A" / "back").symlink_to(root)  # cycle
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "elsewhere" / "2.flac").touch()
    (root / "B").symlink_to(tmp_path / "elsewhere")  # regular linked folder
    assert set(_walk(root).found) == {"A/1.mp3", "B/2.flac"}


async def test_featured_artists_are_credited_not_merged_into_names(
    client, admin, make_audio, run_jobs
):
    duet = make_audio(
        "СВ/01.flac",
        title="Тихие города",
        artist="Северный Ветер feat. Анна Лунина",
        album="Тихие города",
        year=2021,
    )
    solo = make_audio(
        "VA/01.flac",
        title="Тёплый ветер",
        artist="Анна Лунина",
        album="Лето 2024",
        album_artist="Various Artists",
        year=2024,
    )
    await scan(client, admin, run_jobs)

    artists = {a["name"]: a for a in (await client.get("/artists", headers=admin)).json()["items"]}
    assert set(artists) == {"Анна Лунина", "Северный Ветер", "Various Artists"}
    tracks = {t["title"]: t for t in (await client.get("/tracks", headers=admin)).json()["items"]}
    assert tracks["Тихие города"]["artist"]["name"] == "Северный Ветер"
    assert [a["name"] for a in tracks["Тихие города"]["artists"]] == [
        "Северный Ветер",
        "Анна Лунина",
    ]
    assert tracks["Тихие города"]["album_artist"]["name"] == "Северный Ветер"

    anna = (await client.get(f"/artists/{artists['Анна Лунина']['id']}", headers=admin)).json()
    assert anna["albums"] == []
    assert [a["title"] for a in anna["appears_on"]] == ["Лето 2024", "Тихие города"]
    assert {t["title"] for t in anna["top_tracks"]} == {"Тихие города", "Тёплый ветер"}
    wind = (await client.get(f"/artists/{artists['Северный Ветер']['id']}", headers=admin)).json()
    assert [a["title"] for a in wind["albums"]] == ["Тихие города"]
    assert wind["appears_on"] == []

    # An artist only featured goes with the last track crediting them.
    solo.unlink()
    await scan(client, admin, run_jobs)
    names = [a["name"] for a in (await client.get("/artists", headers=admin)).json()["items"]]
    assert names == ["Анна Лунина", "Северный Ветер"]
    duet.unlink()
    # The last file gone: removed once an admin confirms (an empty folder may be unmounted).
    await client.post("/library/scan", json={"remove_missing": True}, headers=admin)
    await run_jobs()
    assert (await client.get("/artists", headers=admin)).json()["items"] == []


async def test_disc_folders_share_the_art_above_them(client, admin, make_audio, run_jobs, settings):
    for disc in (1, 2):
        make_audio(
            f"Хор/Дорога/CD{disc}/01.flac",
            title=f"Disc {disc}",
            artist="Хор",
            album="Дорога",
            track=1,
            disc=disc,
        )
    cover = settings.library_path / "Хор" / "Дорога" / "cover.png"
    cover.write_bytes(png_bytes((200, 40, 40)))
    await scan(client, admin, run_jobs)
    (album,) = (await client.get("/albums", headers=admin)).json()["items"]
    assert album["cover_palette"]["average"] == "#c82828"
    await client.post("/library/scan", headers=admin)
    assert await run_jobs() == 1  # the image is known to be the album's: nothing to redo

    cover.write_bytes(png_bytes((10, 10, 90), size=80))
    await scan(client, admin, run_jobs)
    (album,) = (await client.get("/albums", headers=admin)).json()["items"]
    assert album["cover_palette"]["average"] == "#0a0a5a"
    tracks = (await client.get(f"/albums/{album['id']}", headers=admin)).json()["tracks"]
    assert [(t["disc_no"], t["title"]) for t in tracks] == [(1, "Disc 1"), (2, "Disc 2")]


async def test_overlong_names_are_clipped_not_refused(client, admin, make_audio, run_jobs):
    make_audio("a/1.mp3", title="T", artist="A", album="Очень длинное название " * 40)
    await scan(client, admin, run_jobs)
    (album,) = (await client.get("/albums", headers=admin)).json()["items"]
    assert album["title"].startswith("Очень длинное") and len(album["title"]) <= 512


async def test_genres_and_sorting(client, admin, make_audio, run_jobs):
    make_audio("1.mp3", title="b", artist="Zeta", album="Alpha", year=2001, genre="Rock")
    make_audio("2.mp3", title="C", artist="Alpha", album="Omega", year=2010, genre="rock")
    make_audio("3.mp3", title="a", artist="Mid", album="Mid", year=2005, genre="Jazz")
    make_audio("4.mp3", title="d", artist="Alpha", album="Beta", year=1999)
    await scan(client, admin, run_jobs)

    genres = (await client.get("/genres", headers=admin)).json()
    assert [(g["name"].casefold(), g["album_count"]) for g in genres] == [("rock", 2), ("jazz", 1)]
    rock = (await client.get("/albums?genre=ROCK&sort=title", headers=admin)).json()["items"]
    assert [a["title"] for a in rock] == ["Alpha", "Omega"]

    async def albums(sort: str) -> list[str]:
        page = (await client.get(f"/albums?sort={sort}", headers=admin)).json()
        return [a["title"] for a in page["items"]]

    assert await albums("artist") == ["Beta", "Omega", "Mid", "Alpha"]
    assert await albums("year") == ["Omega", "Mid", "Alpha", "Beta"]

    async def tracks(sort: str) -> list[str]:
        page = (await client.get(f"/tracks?sort={sort}", headers=admin)).json()
        return [t["title"] for t in page["items"]]

    assert await tracks("title") == ["a", "b", "C", "d"]
    assert await tracks("artist") == ["d", "C", "a", "b"]
    assert await tracks("album") == ["b", "d", "a", "C"]


async def test_recently_added_tracks_come_album_by_album(client, admin, make_audio, run_jobs):
    make_audio("x/2.mp3", title="X2", artist="A", album="X", track=2)
    await scan(client, admin, run_jobs)
    # Album X is older than Y, though two of its tracks came with Y's.
    for n in (3, 1):
        make_audio(f"x/{n}.mp3", title=f"X{n}", artist="A", album="X", track=n)
    for n in (2, 1):
        make_audio(f"y/{n}.mp3", title=f"Y{n}", artist="A", album="Y", track=n)
    await scan(client, admin, run_jobs)
    page = (await client.get("/tracks?sort=added", headers=admin)).json()
    assert [t["title"] for t in page["items"]] == ["Y1", "Y2", "X1", "X2", "X3"]


async def last_scan(client, admin) -> dict:
    return (await client.get("/library/scan", headers=admin)).json()["result"]


async def test_scan_of_an_empty_folder_removes_nothing_until_told(
    client, admin, make_audio, run_jobs, settings
):
    """An unmounted disk leaves the music folder empty: the tracks, with their likes, stay
    until an admin says the music is gone."""
    make_audio("A/1.mp3", title="One", artist="A", album="X")
    make_audio("A/2.mp3", title="Two", artist="A", album="X")
    await scan(client, admin, run_jobs)
    one = (await client.get("/tracks", headers=admin)).json()["items"][0]["id"]
    await client.put(f"/me/likes/tracks/{one}", headers=admin)

    shutil.rmtree(settings.library_path / "A")
    await scan(client, admin, run_jobs)
    assert (await last_scan(client, admin)) | {"files": 0} == {
        "files": 0,
        "added": 0,
        "updated": 0,
        "moved": 0,
        "removed": 0,
        "missing": 2,
        "unreadable": 0,
    }
    tracks = (await client.get("/tracks", headers=admin)).json()["items"]
    assert len(tracks) == 2 and next(t for t in tracks if t["id"] == one)["liked"]

    started = await client.post("/library/scan", json={"remove_missing": True}, headers=admin)
    assert started.status_code == 202
    await run_jobs()
    assert (await last_scan(client, admin))["removed"] == 2
    assert (await client.get("/tracks", headers=admin)).json()["total"] == 0


async def test_scan_waits_when_much_of_the_library_vanished_at_once(
    client, admin, make_audio, run_jobs, settings, monkeypatch
):
    monkeypatch.setattr(importer, "MASS_REMOVAL", 2)
    for n in range(1, 5):
        make_audio(f"Disk/{n}.mp3", title=f"T{n}", artist="A", album="X")
    make_audio("Here/1.mp3", title="Here", artist="B", album="Y")
    await scan(client, admin, run_jobs)

    shutil.rmtree(settings.library_path / "Disk")
    await scan(client, admin, run_jobs)
    result = await last_scan(client, admin)
    assert (result["files"], result["removed"], result["missing"]) == (1, 0, 4)
    assert (await client.get("/tracks", headers=admin)).json()["total"] == 5

    # A few gone is an ordinary deletion.
    monkeypatch.setattr(importer, "MASS_REMOVAL", 50)
    await scan(client, admin, run_jobs)
    assert (await last_scan(client, admin))["removed"] == 4


async def test_tracks_in_folders_that_cant_be_read_stay(
    client, admin, make_audio, run_jobs, settings, tmp_path, monkeypatch
):
    # A folder on another disk, linked into the library.
    disk = tmp_path / "disk2"
    (disk / "Album").mkdir(parents=True)
    make_audio("Local/1.mp3", title="Local", artist="A", album="X")
    make_audio("Local/2.mp3", title="Unreadable", artist="A", album="Z")
    linked = make_audio("Local/3.mp3", title="Linked", artist="B", album="Y")
    linked.rename(disk / "Album" / "1.mp3")
    (settings.library_path / "Disk2").symlink_to(disk)
    await scan(client, admin, run_jobs)
    assert (await client.get("/tracks", headers=admin)).json()["total"] == 3

    # The disk is gone (the link dangles), and a folder can't be listed.
    shutil.rmtree(disk)
    real_scandir = os.scandir

    def scandir(path="."):
        if os.fspath(path).endswith("/Local"):
            raise PermissionError(13, "Permission denied", os.fspath(path))
        return real_scandir(path)

    monkeypatch.setattr(os, "scandir", scandir)
    await scan(client, admin, run_jobs)
    result = await last_scan(client, admin)
    assert (result["removed"], result["unreadable"], result["missing"]) == (0, 3, 0)
    assert (await client.get("/tracks", headers=admin)).json()["total"] == 3


async def test_an_import_in_an_empty_library_folder_deletes_nothing(
    client, admin, make_audio, run_jobs, settings, job_ctx
):
    path = make_audio("A/1.mp3", title="One", artist="A", album="X")
    await scan(client, admin, run_jobs)
    path.write_bytes(path.read_bytes() + b"\0")  # changed: the next scan imports it again
    async with job_ctx.sessionmaker() as session:
        await enqueue(session, "import_track", {"path": "A/1.mp3"}, dedupe_key="import:A/1.mp3")
        await session.commit()
    shutil.rmtree(settings.library_path / "A")
    await run_jobs()
    assert (await client.get("/tracks", headers=admin)).json()["total"] == 1


async def test_an_albums_folder_cover_is_read_once_not_per_track(
    client, admin, make_audio, run_jobs, monkeypatch
):
    reads = []
    album_picture = importer._album_picture

    def counted(root, paths):
        reads.append(paths)
        return album_picture(root, paths)

    monkeypatch.setattr(importer, "_album_picture", counted)
    for n in range(1, 5):
        make_audio(f"F/{n}.flac", title=f"T{n}", artist="A", album="X", track=n, cover=(5, 6, 7))
    await scan(client, admin, run_jobs)
    assert len(reads) == 1
    album = (await client.get("/albums", headers=admin)).json()["items"][0]
    assert album["cover_id"]
