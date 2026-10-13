import errno

from app.db import utcnow
from app.jobs.models import Job, JobStatus
from app.library import admin as library_admin
from tests.conftest import png_bytes


async def scan(client, admin, run_jobs) -> dict:
    assert (await client.post("/library/scan", headers=admin)).status_code == 202
    await run_jobs()
    return (await client.get("/library/scan", headers=admin)).json()


async def test_scan_reports_what_it_found(client, admin, make_audio, run_jobs, settings):
    assert (await client.get("/library/scan", headers=admin)).json() is None
    for n, title in enumerate(["One", "Two", "Three"], start=1):
        make_audio(f"A/X/0{n}.mp3", title=title, artist="A", album="X", track=n)

    queued = (await client.post("/library/scan", headers=admin)).json()
    assert queued["status"] == "queued" and queued["result"] is None
    assert queued["imports"] == {"queued": 0, "running": 0, "done": 0, "failed": 0}
    # Asked again while it waits: the same scan.
    assert (await client.post("/library/scan", headers=admin)).json()["id"] == queued["id"]
    await run_jobs()
    done = (await client.get("/library/scan", headers=admin)).json()
    assert done["id"] == queued["id"] and done["status"] == "done" and done["finished_at"]
    assert done["result"] == {"files": 3, "added": 3, "updated": 0, "moved": 0, "removed": 0}
    assert done["imports"] == {"queued": 0, "running": 0, "done": 3, "failed": 0}

    lib = settings.library_path
    (lib / "A/X/01.mp3").rename(lib / "A/X/01 - One.mp3")
    make_audio("A/X/02.mp3", title="Two (edited)", artist="A", album="X", track=2)
    (lib / "A/X/03.mp3").unlink()
    make_audio("A/X/04.mp3", title="Four", artist="A", album="X", track=4)
    result = (await scan(client, admin, run_jobs))["result"]
    assert result == {"files": 3, "added": 1, "updated": 1, "moved": 1, "removed": 1}


async def test_library_stats(client, admin, make_audio, run_jobs):
    stats = (await client.get("/library/stats", headers=admin)).json()
    assert stats == {"artists": 0, "albums": 0, "tracks": 0, "duration_ms": 0, "size_bytes": 0}
    files = [
        make_audio("A/1.mp3", title="One", artist="A", album="X", duration=2),
        make_audio("B/1.mp3", title="Two", artist="B feat. C", album="Y", duration=3),
    ]
    await scan(client, admin, run_jobs)
    stats = (await client.get("/library/stats", headers=admin)).json()
    assert {k: stats[k] for k in ("artists", "albums", "tracks")} == {
        "artists": 3,
        "albums": 2,
        "tracks": 2,
    }
    assert abs(stats["duration_ms"] - 5000) < 200
    assert stats["size_bytes"] == sum(f.stat().st_size for f in files)


async def test_jobs_in_pages_say_what_they_are_about(client, admin, make_audio, run_jobs):
    make_audio("A/X/01.mp3", title="One", artist="A", album="X")
    await scan(client, admin, run_jobs)

    jobs = (await client.get("/library/jobs", headers=admin)).json()
    assert jobs["total"] == 4
    assert {j["kind"]: j["subject"] for j in jobs["items"]} == {
        "scan_library": None,
        "import_track": "A/X/01.mp3",
        "transcode": "A — One",
        "fetch_lyrics": "A — One",
    }
    first = (await client.get("/library/jobs?limit=3", headers=admin)).json()["items"]
    rest = (await client.get("/library/jobs?limit=3&offset=3", headers=admin)).json()["items"]
    assert [j["id"] for j in first + rest] == [j["id"] for j in jobs["items"]]

    imports = (await client.get("/library/jobs?kind=import_track", headers=admin)).json()
    assert [(j["kind"], j["status"]) for j in imports["items"]] == [("import_track", "done")]


async def test_failed_jobs_run_again_or_are_forgotten(client, admin, sessionmaker):
    def failed(kind: str, path: str | None = None, error: str = "boom") -> Job:
        return Job(
            kind=kind,
            payload={"path": path} if path else {},
            dedupe_key=f"import:{path}" if path else None,
            status=JobStatus.failed,
            attempts=3,
            error=error,
            finished_at=utcnow(),
        )

    async with sessionmaker() as session:
        lone = failed("housekeeping")
        session.add_all(
            [
                lone,
                failed("import_track", "a.mp3"),
                failed("import_track", "a.mp3", "boom again"),  # failed twice
                failed("import_track", "b.mp3"),
                # Already pending again: retrying leaves it as it is.
                Job(kind="import_track", payload={"path": "b.mp3"}, dedupe_key="import:b.mp3"),
            ]
        )
        await session.commit()
        lone_id = str(lone.id)

    assert (await client.post(f"/library/jobs/{lone_id}/retry", headers=admin)).status_code == 204
    again = await client.post(f"/library/jobs/{lone_id}/retry", headers=admin)
    assert again.status_code == 404 and again.json()["code"] == "job_not_found"
    (housekeeping,) = (await client.get("/library/jobs?kind=housekeeping", headers=admin)).json()[
        "items"
    ]
    assert housekeeping["status"] == "queued" and housekeeping["attempts"] == 0
    assert housekeeping["error"] is None

    retried = await client.post("/library/jobs/retry", headers=admin)
    assert retried.json() == {"retried": 3}
    summary = (await client.get("/library/jobs/summary", headers=admin)).json()
    assert summary["failed"] == 0 and summary["kinds"]["import_track"]["queued"] == 2

    async with sessionmaker() as session:
        session.add(failed("import_track", "c.mp3"))
        await session.commit()
    assert (await client.delete("/library/jobs/failed", headers=admin)).status_code == 204
    summary = (await client.get("/library/jobs/summary", headers=admin)).json()
    assert summary["failed"] == 0 and summary["pending"] == 3


async def test_upload_status_follows_the_import(client, admin, make_audio, run_jobs):
    good = make_audio("../good.mp3", title="Good", artist="U", album="Up").read_bytes()
    resp = await client.post(
        "/library/uploads",
        files=[("files", ("good.mp3", good)), ("files", ("bad.mp3", b"not audio at all" * 99))],
        headers=admin,
    )
    paths = [r["path"] for r in resp.json()]
    assert paths == ["uploads/good.mp3", "uploads/bad.mp3"]

    async def status() -> list[dict]:
        body = {"paths": [*paths, "uploads/never.mp3"]}
        resp = await client.post("/library/uploads/status", json=body, headers=admin)
        assert resp.status_code == 200, resp.text
        return resp.json()

    assert [s["state"] for s in await status()] == ["queued", "queued", "missing"]
    await run_jobs()
    good_status, bad_status, never = await status()
    assert good_status["state"] == "imported" and good_status["error"] is None
    assert good_status["track"]["title"] == "Good"
    assert good_status["track"]["album"]["title"] == "Up"
    # Not audio: failed at once, not retried in a while.
    assert bad_status["state"] == "failed" and bad_status["track"] is None
    assert bad_status["error"] == "can't sync to MPEG frame"
    assert never == {"path": "uploads/never.mp3", "state": "missing", "error": None, "track": None}


async def test_an_album_folder_comes_with_its_cover_and_lyrics(client, admin, make_audio, run_jobs):
    song = make_audio("../song.mp3", title="Song", artist="A", album="Folder").read_bytes()
    folder = "A/Folder (2020)"
    for name, data in [
        ("cover.png", png_bytes((10, 200, 30))),
        ("01 Song.lrc", b"[00:01.00]Hello there\n"),
        ("01 Song.mp3", song),
    ]:
        resp = await client.post(
            "/library/uploads",
            data={"folder": folder},
            files=[("files", (name, data))],
            headers=admin,
        )
        assert resp.json() == [{"path": f"uploads/{folder}/{name}", "duplicate": False}]
    # Only the audio is imported; the scan finds the rest beside it.
    assert (await client.get("/library/jobs/summary", headers=admin)).json()["pending"] == 1
    await run_jobs()
    (album,) = (await client.get("/albums", headers=admin)).json()["items"]
    assert album["cover_palette"]["average"] == "#0ac81e"
    (track,) = (await client.get("/tracks", headers=admin)).json()["items"]
    lyrics = (await client.get(f"/tracks/{track['id']}/lyrics", headers=admin)).json()
    assert lyrics["source"] == "sidecar" and lyrics["plain"] == "Hello there"

    # Nothing can leave uploads/ or hide in it.
    resp = await client.post(
        "/library/uploads",
        data={"folder": "../../.hidden/./x"},
        files=[("files", (".cover.png", png_bytes((1, 2, 3))))],
        headers=admin,
    )
    assert resp.json() == [{"path": "uploads/hidden/x/cover.png", "duplicate": False}]
    refused = await client.post(
        "/library/uploads", files=[("files", ("notes.md", b"# hi"))], headers=admin
    )
    assert refused.status_code == 415 and refused.json()["code"] == "not_an_audio_file"


async def test_the_same_file_is_not_uploaded_twice(client, admin, make_audio, run_jobs, settings):
    in_library = make_audio("A/X/01.mp3", title="One", artist="A", album="X")
    await scan(client, admin, run_jobs)
    fresh = make_audio("../fresh.mp3", title="Fresh", artist="A", album="X").read_bytes()
    resp = await client.post(
        "/library/uploads",
        files=[
            ("files", ("copy.mp3", in_library.read_bytes())),
            ("files", ("fresh.mp3", fresh)),
            ("files", ("fresh again.mp3", fresh)),
        ],
        headers=admin,
    )
    assert resp.json() == [
        {"path": "A/X/01.mp3", "duplicate": True},
        {"path": "uploads/fresh.mp3", "duplicate": False},
        {"path": "uploads/fresh.mp3", "duplicate": True},
    ]
    assert [p.name for p in settings.uploads_path.iterdir()] == ["fresh.mp3"]


async def test_a_library_the_server_cant_write_to(client, admin, monkeypatch):
    def fail(error: OSError):
        def save(*args, **kwargs):
            raise error

        return save

    for error, status, code in [
        (PermissionError(errno.EACCES, "Permission denied"), 503, "library_not_writable"),
        (OSError(errno.EROFS, "Read-only file system"), 503, "library_not_writable"),
        (OSError(errno.ENOSPC, "No space left on device"), 507, "disk_full"),
    ]:
        monkeypatch.setattr(library_admin, "save_upload", fail(error))
        resp = await client.post(
            "/library/uploads", files=[("files", ("song.mp3", b"ID3"))], headers=admin
        )
        assert (resp.status_code, resp.json()["code"]) == (status, code)


async def test_users_last_seen_and_signed_out_everywhere(client, admin, user):
    new = {"username": "new", "password": "new-password"}
    assert (await client.post("/auth/register", json=new, headers=admin)).status_code == 201
    phone = await client.post(
        "/auth/login", json={"username": "listener", "password": "listener-password"}
    )
    users = {u["username"]: u for u in (await client.get("/users", headers=admin)).json()}
    assert list(users) == ["admin", "listener", "new"]
    assert users["listener"]["sessions"] == 2 and users["listener"]["last_seen_at"]
    assert users["new"]["sessions"] == 0 and users["new"]["last_seen_at"] is None

    assert (await client.delete("/users/listener/sessions", headers=user)).status_code == 403
    assert (await client.delete("/users/listener/sessions", headers=admin)).status_code == 204
    users = {u["username"]: u for u in (await client.get("/users", headers=admin)).json()}
    assert users["listener"]["sessions"] == 0 and users["admin"]["sessions"] == 1
    refresh = await client.post(
        "/auth/refresh", json={"refresh_token": phone.json()["refresh_token"]}
    )
    assert refresh.json()["code"] == "invalid_refresh_token"


async def test_administration_is_for_admins(client, user):
    for method, url in [
        ("GET", "/library/stats"),
        ("GET", "/library/scan"),
        ("POST", "/library/jobs/retry"),
        ("DELETE", "/library/jobs/failed"),
        ("GET", "/users"),
    ]:
        resp = await client.request(method, url, headers=user)
        assert resp.status_code == 403, url
    resp = await client.post("/library/uploads/status", json={"paths": ["a"]}, headers=user)
    assert resp.status_code == 403
