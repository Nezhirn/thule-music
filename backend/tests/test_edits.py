"""Admins correcting what the files say: lyrics, an album's cover, a track's own picture."""

import os
import time
from pathlib import Path

from app.jobs.housekeeping import housekeeping
from app.library import edits
from tests.conftest import png_bytes


async def scan(client, admin, run_jobs) -> None:
    assert (await client.post("/library/scan", headers=admin)).status_code == 202
    await run_jobs()


def touch_later(path: Path, seconds: int = 2) -> None:
    later = time.time() + seconds
    os.utime(path, (later, later))


def upload(color: tuple[int, int, int]) -> dict:
    return {"file": ("cover.png", png_bytes(color))}


async def test_lyrics_written_by_an_admin_stay(client, admin, user, make_audio, run_jobs):
    audio = make_audio("a/1.mp3", title="Song", artist="A", album="L", lyrics="from the tags")
    await scan(client, admin, run_jobs)
    (track,) = (await client.get("/tracks", headers=admin)).json()["items"]
    url = f"/tracks/{track['id']}/lyrics"

    resp = await client.put(url, json={"text": "first line\n\nsecond verse"}, headers=admin)
    assert resp.status_code == 200, resp.text
    assert resp.json() | {"track_id": None} == {
        "track_id": None,
        "source": "manual",
        "instrumental": False,
        "synced": False,
        "lines": [],
        "plain": "first line\n\nsecond verse",
    }
    assert (await client.get(url, headers=user)).json()["plain"] == "first line\n\nsecond verse"

    # A lyrics file appearing, and the audio file changing, don't replace them.
    audio.with_suffix(".lrc").write_text("[00:01.00]from the file", encoding="utf-8")
    touch_later(audio)
    await scan(client, admin, run_jobs)
    assert (await client.get(url, headers=user)).json()["source"] == "manual"

    # Timed lines are taken, and shown without their times.
    timed = await client.put(url, json={"text": "[00:01.00]one\n[00:02.00]two"}, headers=admin)
    assert timed.json()["synced"] is True and timed.json()["plain"] == "one\ntwo"
    instrumental = await client.put(url, json={"instrumental": True}, headers=admin)
    assert instrumental.json()["instrumental"] is True and instrumental.json()["plain"] is None

    # Empty: wrong lyrics taken away. The track has none, and scans don't bring them back.
    taken = await client.put(url, json={"text": "  \n"}, headers=admin)
    assert taken.status_code == 200 and taken.json() is None
    await scan(client, admin, run_jobs)
    assert (await client.get(url, headers=user)).json()["code"] == "lyrics_not_found"

    # Given up: found again as an import finds them.
    assert (await client.delete(url, headers=admin)).status_code == 202
    await run_jobs()
    again = (await client.get(url, headers=user)).json()
    assert again["source"] == "sidecar" and again["plain"] == "from the file"

    assert (await client.put(url, json={"text": "x"}, headers=user)).json()["code"] == "admin_only"
    assert (await client.delete(url, headers=user)).status_code == 403
    long = await client.put(url, json={"text": "x" * 100_001}, headers=admin)
    assert long.status_code == 422
    missing = await client.put(
        "/tracks/00000000-0000-0000-0000-000000000000/lyrics", json={"text": "x"}, headers=admin
    )
    assert missing.json()["code"] == "track_not_found"


async def test_a_cover_chosen_by_an_admin_stays(
    client, admin, user, make_audio, run_jobs, monkeypatch
):
    audio = make_audio("a/1.flac", title="One", artist="A", album="Album", cover=(200, 0, 0))
    await scan(client, admin, run_jobs)
    (album,) = (await client.get("/albums", headers=admin)).json()["items"]
    url = f"/albums/{album['id']}/cover"
    assert album["cover_palette"]["average"] == "#c80000"

    resp = await client.put(url, files=upload((0, 0, 200)), headers=admin)
    assert resp.status_code == 200, resp.text
    chosen = resp.json()
    assert chosen["cover_palette"]["average"] == "#0000c8"
    detail = (await client.get(f"/albums/{album['id']}", headers=user)).json()
    assert detail["cover_custom"] is True and detail["cover_id"] == chosen["cover_id"]
    assert detail["tracks"][0]["cover_id"] == chosen["cover_id"]

    # A new folder image and a changed audio file don't replace it.
    folder_image = audio.parent / "cover.png"
    folder_image.write_bytes(png_bytes((0, 200, 0)))
    touch_later(folder_image)
    touch_later(audio)
    await scan(client, admin, run_jobs)
    assert (await client.get(f"/albums/{album['id']}", headers=user)).json()["cover_id"] == (
        chosen["cover_id"]
    )

    # Given up: the folder has the say again.
    reset = await client.delete(url, headers=admin)
    assert reset.status_code == 200 and reset.json()["cover_palette"]["average"] == "#00c800"
    detail = (await client.get(f"/albums/{album['id']}", headers=user)).json()
    assert detail["cover_custom"] is False

    bad = await client.put(url, files={"file": ("x.png", b"nope")}, headers=admin)
    assert bad.status_code == 415 and bad.json()["code"] == "not_an_image"
    monkeypatch.setattr(edits, "MAX_COVER_BYTES", 100)
    big = await client.put(url, files=upload((1, 2, 3)), headers=admin)
    assert big.status_code == 413 and big.json()["code"] == "image_too_large"
    assert (await client.put(url, files=upload((1, 2, 3)), headers=user)).status_code == 403
    missing = await client.delete(
        "/albums/00000000-0000-0000-0000-000000000000/cover", headers=admin
    )
    assert missing.json()["code"] == "album_not_found"


async def test_a_track_shows_its_own_picture(client, admin, user, make_audio, run_jobs, job_ctx):
    make_audio("a/1.flac", title="One", artist="A", album="Album", track=1, cover=(200, 0, 0))
    make_audio("a/2.flac", title="Two", artist="A", album="Album", track=2)
    await scan(client, admin, run_jobs)
    one, two = (await client.get("/tracks?sort=title", headers=admin)).json()["items"]
    album_cover = one["album"]["cover_id"]
    assert one["cover_id"] == two["cover_id"] == album_cover
    assert one["cover_palette"] == one["album"]["cover_palette"]

    resp = await client.put(f"/tracks/{one['id']}/cover", files=upload((0, 0, 200)), headers=admin)
    assert resp.status_code == 200, resp.text
    own = resp.json()
    assert own["cover_palette"]["average"] == "#0000c8"
    assert own["album"]["cover_id"] == album_cover  # the album keeps its cover

    detail = (await client.get(f"/albums/{one['album']['id']}", headers=user)).json()
    assert detail["cover_id"] == album_cover
    assert [t["cover_id"] for t in detail["tracks"]] == [own["cover_id"], album_cover]
    playlist = (await client.post("/playlists", json={"name": "P"}, headers=user)).json()
    await client.post(
        f"/playlists/{playlist['id']}/tracks",
        json={"track_ids": [one["id"], two["id"]]},
        headers=user,
    )
    (listed,) = (await client.get("/playlists", headers=user)).json()
    assert listed["cover_ids"] == [own["cover_id"], album_cover]

    # Not an unused cover to clean up.
    await housekeeping(job_ctx, {})
    assert (await client.get(f"/covers/{own['cover_id']}?size=64")).status_code == 200

    reset = await client.delete(f"/tracks/{one['id']}/cover", headers=admin)
    assert reset.status_code == 200 and reset.json()["cover_id"] == album_cover
    assert (await client.delete(f"/tracks/{one['id']}/cover", headers=user)).status_code == 403


async def test_an_artists_picture_chosen_by_an_admin(
    client, admin, user, make_audio, run_jobs, job_ctx
):
    make_audio("a/1.mp3", title="Song", artist="A", album="Old", year=2001, cover=(10, 10, 10))
    make_audio("b/1.mp3", title="Hit", artist="A", album="New", year=2020, cover=(200, 0, 0))
    await scan(client, admin, run_jobs)
    (artist,) = (await client.get("/artists", headers=user)).json()["items"]
    newest = (await client.get(f"/artists/{artist['id']}", headers=user)).json()
    assert newest["cover_custom"] is False and newest["cover_id"] is not None

    url = f"/artists/{artist['id']}/cover"
    resp = await client.put(url, files=upload((0, 0, 255)), headers=admin)
    assert resp.status_code == 200, resp.text
    chosen = resp.json()["cover_id"]
    assert chosen not in (None, newest["cover_id"])
    assert resp.json()["cover_palette"]["average"] == "#0000ff"
    detail = (await client.get(f"/artists/{artist['id']}", headers=user)).json()
    assert detail["cover_custom"] is True and detail["cover_id"] == chosen
    assert (await client.get("/artists", headers=user)).json()["items"][0]["cover_id"] == chosen

    # Scans and housekeeping keep it.
    await scan(client, admin, run_jobs)
    await housekeeping(job_ctx, {})
    assert (await client.get(f"/artists/{artist['id']}", headers=user)).json()["cover_id"] == chosen
    assert (await client.get(f"/covers/{chosen}?size=64")).status_code == 200

    reset = await client.delete(url, headers=admin)
    assert reset.status_code == 200 and reset.json()["cover_id"] == newest["cover_id"]
    assert (await client.put(url, files=upload((1, 1, 1)), headers=user)).status_code == 403
    missing = "/artists/00000000-0000-0000-0000-000000000000/cover"
    assert (await client.delete(missing, headers=admin)).json()["code"] == "artist_not_found"
