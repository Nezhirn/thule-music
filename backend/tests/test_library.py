import pytest

from app.library.importer import resolve_in_library


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
    assert night["cover_color"] == "#c82828"

    detail = (await client.get(f"/albums/{night['id']}", headers=admin)).json()
    assert [t["title"] for t in detail["tracks"]] == ["A Line in the Dust", "Second"]
    assert detail["duration_ms"] == pytest.approx(4000, abs=200)
    assert detail["tracks"][0]["codec"] == "mp3"

    # FLAC got its artwork from the folder's cover.png
    lune = next(a for a in albums if a["title"] == "Écailles de Lune")
    assert lune["cover_color"] == "#0a0a5a"
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


async def test_upload_rejects_non_audio(client, admin):
    resp = await client.post(
        "/library/uploads",
        files=[("files", ("x.exe", b"MZ", "application/octet-stream"))],
        headers=admin,
    )
    assert resp.status_code == 415


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
