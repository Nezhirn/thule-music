import pytest

from app.library.importer import _walk, resolve_in_library


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
    assert resp.json() == [{"path": "uploads/evil name.mp3"}]
    await run_jobs()
    tracks = (await client.get("/tracks", headers=admin)).json()["items"]
    assert [t["title"] for t in tracks] == ["Uploaded"]


async def test_upload_keeps_existing_files(client, admin, make_audio, settings):
    src = make_audio("../outside.mp3", title="Uploaded", artist="U", album="Up")
    data = src.read_bytes()
    resp = await client.post(
        "/library/uploads",
        files=[("files", ("song.mp3", data, "audio/mpeg")), ("files", ("song.mp3", data))],
        headers=admin,
    )
    assert resp.status_code == 202, resp.text
    assert resp.json() == [{"path": "uploads/song.mp3"}, {"path": "uploads/song (1).mp3"}]
    assert (settings.uploads_path / "song (1).mp3").read_bytes() == data


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


async def test_jobs_listing(client, admin, make_audio, run_jobs):
    make_audio("a/1.mp3", title="T", artist="A", album="X")
    await scan(client, admin, run_jobs)
    jobs = (await client.get("/library/jobs", headers=admin)).json()
    assert {j["kind"] for j in jobs} == {
        "scan_library",
        "import_track",
        "transcode",
        "fetch_lyrics",
    }
    assert all(j["status"] == "done" for j in jobs)


def test_resolve_in_library_blocks_traversal(tmp_path):
    with pytest.raises(ValueError):
        resolve_in_library(tmp_path, "../etc/passwd")
    assert resolve_in_library(tmp_path, "a/b.mp3") == (tmp_path / "a/b.mp3").resolve()


def test_scan_follows_symlinks_but_not_cycles(tmp_path):
    root = tmp_path / "library"
    (root / "A").mkdir(parents=True)
    (root / "A" / "1.mp3").touch()
    (root / "A" / "back").symlink_to(root)  # cycle
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "elsewhere" / "2.flac").touch()
    (root / "B").symlink_to(tmp_path / "elsewhere")  # regular linked folder
    assert set(_walk(root)) == {"A/1.mp3", "B/2.flac"}
