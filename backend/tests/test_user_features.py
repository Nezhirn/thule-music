"""Playlists, likes, play history, home feed, search and lyrics."""

import os
import time
from datetime import timedelta

import httpx
import pytest
from sqlalchemy import func, select

from app.db import utcnow
from app.jobs.models import Job, JobStatus
from app.lyrics import fetch as lyrics_fetch


@pytest.fixture
async def catalog(client, admin, make_audio, run_jobs) -> dict[str, dict]:
    night = {"artist": "Katatonia", "album": "Night", "year": 2020}
    make_audio("k/1.mp3", title="A Line in the Dust", track=1, **night)
    make_audio("k/2.mp3", title="Lethean", track=2, **night)
    make_audio("c/1.mp3", title="Dissolution", artist="The Cure", album="Faith", year=1981)
    make_audio("a/1.mp3", title="Solitude", artist="Mare Cognitum", album="Solar", year=2017)
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    tracks = (await client.get("/tracks", headers=admin)).json()["items"]
    return {t["title"]: t for t in tracks}


async def test_playlist_lifecycle(client, admin, user, catalog):
    ids = [catalog[name]["id"] for name in ("Lethean", "Dissolution", "Solitude")]
    created = await client.post("/playlists", json={"name": "Late Night"}, headers=user)
    assert created.status_code == 201
    pid = created.json()["id"]

    added = await client.post(f"/playlists/{pid}/tracks", json={"track_ids": ids}, headers=user)
    assert [i["track"]["title"] for i in added.json()["items"]] == [
        "Lethean",
        "Dissolution",
        "Solitude",
    ]
    assert added.json()["track_count"] == 3

    # Insert at the front, then move the last item to position 1.
    front = await client.post(
        f"/playlists/{pid}/tracks",
        json={"track_ids": [catalog["A Line in the Dust"]["id"]], "position": 0},
        headers=user,
    )
    items = front.json()["items"]
    assert items[0]["track"]["title"] == "A Line in the Dust"
    assert [i["position"] for i in items] == [0, 1, 2, 3]
    moved = await client.post(
        f"/playlists/{pid}/move",
        json={"item_id": items[-1]["item_id"], "position": 1},
        headers=user,
    )
    titles = [i["track"]["title"] for i in moved.json()["items"]]
    assert titles == ["A Line in the Dust", "Solitude", "Lethean", "Dissolution"]
    assert [i["position"] for i in moved.json()["items"]] == [0, 1, 2, 3]

    removed = await client.delete(
        f"/playlists/{pid}/tracks/{moved.json()['items'][2]['item_id']}", headers=user
    )
    assert [i["track"]["title"] for i in removed.json()["items"]] == [
        "A Line in the Dust",
        "Solitude",
        "Dissolution",
    ]
    assert [i["position"] for i in removed.json()["items"]] == [0, 1, 2]

    renamed = await client.patch(f"/playlists/{pid}", json={"name": "Chill"}, headers=user)
    assert renamed.json()["name"] == "Chill"
    listing = (await client.get("/playlists", headers=user)).json()
    assert [(p["name"], p["track_count"]) for p in listing] == [("Chill", 3)]

    # Other users can't see or edit it.
    assert (await client.get(f"/playlists/{pid}", headers=admin)).status_code == 404
    assert (await client.delete(f"/playlists/{pid}", headers=admin)).status_code == 404

    assert (await client.delete(f"/playlists/{pid}", headers=user)).status_code == 204
    assert (await client.get("/playlists", headers=user)).json() == []


async def test_playlist_rejects_unknown_tracks(client, user, catalog):
    pid = (await client.post("/playlists", json={"name": "P"}, headers=user)).json()["id"]
    resp = await client.post(
        f"/playlists/{pid}/tracks",
        json={"track_ids": ["00000000-0000-0000-0000-000000000000"]},
        headers=user,
    )
    assert resp.status_code == 404


async def test_likes(client, admin, user, catalog):
    tid = catalog["Lethean"]["id"]
    assert (await client.put(f"/me/likes/tracks/{tid}", headers=user)).status_code == 204
    assert (await client.put(f"/me/likes/tracks/{tid}", headers=user)).status_code == 204

    liked = (await client.get("/me/likes/tracks", headers=user)).json()
    assert liked["total"] == 1 and liked["items"][0]["liked"] is True
    assert (await client.get(f"/tracks/{tid}", headers=user)).json()["liked"] is True
    # Likes are per user.
    assert (await client.get(f"/tracks/{tid}", headers=admin)).json()["liked"] is False

    assert (await client.delete(f"/me/likes/tracks/{tid}", headers=user)).status_code == 204
    assert (await client.get("/me/likes/tracks", headers=user)).json()["total"] == 0


async def test_saved_albums_and_followed_artists(client, admin, user, catalog):
    album = catalog["Lethean"]["album"]["id"]
    artist = catalog["Lethean"]["artist"]["id"]
    assert (await client.put(f"/me/likes/albums/{album}", headers=user)).status_code == 204
    assert (await client.put(f"/me/likes/artists/{artist}", headers=user)).status_code == 204

    saved = (await client.get("/me/likes/albums", headers=user)).json()
    assert saved["total"] == 1 and saved["items"][0]["title"] == "Night"
    assert saved["items"][0]["liked"] is True
    followed = (await client.get("/me/likes/artists", headers=user)).json()
    assert [a["name"] for a in followed["items"]] == ["Katatonia"]

    # The flag shows up wherever albums and artists are listed, for this user only.
    assert (await client.get(f"/albums/{album}", headers=user)).json()["liked"] is True
    assert (await client.get(f"/albums/{album}", headers=admin)).json()["liked"] is False
    albums = (await client.get("/albums", headers=user)).json()["items"]
    assert {a["title"]: a["liked"] for a in albums} == {
        "Night": True,
        "Faith": False,
        "Solar": False,
    }
    assert (await client.get(f"/artists/{artist}", headers=user)).json()["liked"] is True
    home = (await client.get("/home", headers=user)).json()
    assert any(a["liked"] for a in home["recently_added"])
    found = (await client.get("/search?q=katatonia", headers=user)).json()
    assert found["artists"][0]["liked"] is True

    assert (await client.delete(f"/me/likes/albums/{album}", headers=user)).status_code == 204
    assert (await client.get("/me/likes/albums", headers=user)).json()["total"] == 0
    missing = await client.put(
        "/me/likes/artists/00000000-0000-0000-0000-000000000000", headers=user
    )
    assert missing.json()["code"] == "artist_not_found"


async def test_plays_recent_and_home(client, user, catalog):
    for name in ("Dissolution", "Lethean", "Dissolution"):
        resp = await client.post(
            "/me/plays",
            json={"track_id": catalog[name]["id"], "listened_ms": 60_000},
            headers=user,
        )
        assert resp.status_code == 204

    recent = (await client.get("/me/recent", headers=user)).json()
    assert [r["track"]["title"] for r in recent] == ["Dissolution", "Lethean"]

    home = (await client.get("/home", headers=user)).json()
    assert {a["title"] for a in home["recently_added"]} == {"Night", "Faith", "Solar"}
    assert [a["title"] for a in home["new_releases"]] == ["Night", "Solar", "Faith"]
    assert [a["title"] for a in home["recently_played"]] == ["Faith", "Night"]
    # Played albums are excluded from "for you"; the unplayed one fills in.
    assert [a["title"] for a in home["for_you"]] == ["Solar"]


async def test_history_lists_every_play_in_pages(client, user, admin, catalog):
    names = ["Dissolution", "Lethean", "Dissolution", "Solitude", "A Line in the Dust"]
    for name in names:
        await client.post("/me/plays", json={"track_id": catalog[name]["id"]}, headers=user)
    await client.post("/me/plays", json={"track_id": catalog["Lethean"]["id"]}, headers=admin)

    first = (await client.get("/me/history", params={"limit": 2}, headers=user)).json()
    assert [p["track"]["title"] for p in first["items"]] == ["A Line in the Dust", "Solitude"]
    # A play recorded meanwhile doesn't shift the next page.
    await client.post("/me/plays", json={"track_id": catalog["Solitude"]["id"]}, headers=user)
    second = (
        await client.get("/me/history", params={"limit": 2, "before": first["next"]}, headers=user)
    ).json()
    assert [p["track"]["title"] for p in second["items"]] == ["Dissolution", "Lethean"]
    last = (
        await client.get("/me/history", params={"limit": 2, "before": second["next"]}, headers=user)
    ).json()
    assert [p["track"]["title"] for p in last["items"]] == ["Dissolution"]
    assert last["next"] is None

    # Someone else's play is no place to page from.
    theirs = (await client.get("/me/history", headers=admin)).json()["items"][0]["id"]
    other = await client.get("/me/history", params={"before": theirs}, headers=user)
    assert other.json() == {"items": [], "next": None}


async def test_clearing_history_forgets_plays(client, user, admin, catalog):
    for headers in (user, admin):
        await client.post("/me/plays", json={"track_id": catalog["Lethean"]["id"]}, headers=headers)
    cleared = await client.delete("/me/history", headers=user)
    assert cleared.status_code == 204
    assert (await client.get("/me/history", headers=user)).json() == {"items": [], "next": None}
    assert (await client.get("/me/recent", headers=user)).json() == []
    assert (await client.get("/home", headers=user)).json()["recently_played"] == []
    # Only theirs.
    assert len((await client.get("/me/history", headers=admin)).json()["items"]) == 1


async def test_artist_page_ranks_top_tracks_by_plays(client, user, catalog):
    await client.post("/me/plays", json={"track_id": catalog["Lethean"]["id"]}, headers=user)
    artist_id = catalog["Lethean"]["artist"]["id"]
    artist = (await client.get(f"/artists/{artist_id}", headers=user)).json()
    assert artist["name"] == "Katatonia"
    assert [a["title"] for a in artist["albums"]] == ["Night"]
    assert [t["title"] for t in artist["top_tracks"]] == ["Lethean", "A Line in the Dust"]


@pytest.mark.parametrize(
    ("query", "artist", "track"),
    [
        ("katatonia", "Katatonia", "A Line in the Dust"),
        ("katatonya", "Katatonia", None),  # typo -> trigram match
        ("dissol", None, "Dissolution"),
        ("100%", None, None),  # LIKE wildcards are escaped
    ],
)
async def test_search(client, user, catalog, query, artist, track):
    result = (await client.get("/search", params={"q": query}, headers=user)).json()
    names = [a["name"] for a in result["artists"]]
    titles = [t["title"] for t in result["tracks"]]
    if artist:
        assert names[0] == artist
    if track:
        assert track in titles
    if not artist and not track:
        assert names == [] and titles == []


async def test_search_lists_albums_by_their_artist(client, user, catalog):
    result = (await client.get("/search", params={"q": "katatonia"}, headers=user)).json()
    assert [a["title"] for a in result["albums"]] == ["Night"]
    result = (await client.get("/search", params={"q": "faith"}, headers=user)).json()
    assert [a["title"] for a in result["albums"]] == ["Faith"]


async def test_search_for_one_kind_in_pages(client, user, catalog):
    query = {"q": "katatonia", "type": "tracks", "limit": 1}
    first = (await client.get("/search", params=query, headers=user)).json()
    assert first["artists"] == [] and first["albums"] == []
    assert [t["title"] for t in first["tracks"]] == ["A Line in the Dust"]
    second = (await client.get("/search", params={**query, "offset": 1}, headers=user)).json()
    assert [t["title"] for t in second["tracks"]] == ["Lethean"]
    third = (await client.get("/search", params={**query, "offset": 2}, headers=user)).json()
    assert third["tracks"] == []

    artists = (
        await client.get("/search", params={"q": "katatonia", "type": "artists"}, headers=user)
    ).json()
    assert [a["name"] for a in artists["artists"]] == ["Katatonia"]
    assert artists["tracks"] == [] and artists["albums"] == []


async def test_lyrics_sources(client, admin, make_audio, run_jobs, settings, lrclib_responses):
    settings.lrclib_enabled = True
    lrclib_responses["From Lrclib"] = httpx.Response(
        200,
        json={
            "syncedLyrics": "[00:01.00]hello\n[00:02.50]world",
            "plainLyrics": "hello\nworld",
            "instrumental": False,
        },
    )
    make_audio("l/1.mp3", title="From Lrclib", artist="A", album="L")
    sidecar = make_audio("l/2.mp3", title="Sidecar", artist="A", album="L")
    sidecar.with_suffix(".lrc").write_text("[00:00.50]side", encoding="utf-8")
    make_audio("l/3.mp3", title="Embedded", artist="A", album="L", lyrics="plain words")
    make_audio("l/4.mp3", title="Nothing", artist="A", album="L")
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    tracks = {
        t["title"]: t["id"] for t in (await client.get("/tracks", headers=admin)).json()["items"]
    }

    lrclib = (await client.get(f"/tracks/{tracks['From Lrclib']}/lyrics", headers=admin)).json()
    assert lrclib["source"] == "lrclib" and lrclib["synced"] is True
    assert lrclib["lines"] == [
        {"time_ms": 1000, "text": "hello"},
        {"time_ms": 2500, "text": "world"},
    ]

    side = (await client.get(f"/tracks/{tracks['Sidecar']}/lyrics", headers=admin)).json()
    assert side["source"] == "sidecar" and side["lines"][0]["text"] == "side"

    emb = (await client.get(f"/tracks/{tracks['Embedded']}/lyrics", headers=admin)).json()
    assert emb["source"] == "embedded" and emb["synced"] is False and emb["plain"] == "plain words"

    missing = await client.get(f"/tracks/{tracks['Nothing']}/lyrics", headers=admin)
    assert missing.status_code == 404


async def test_rescan_notices_lyrics_files(client, admin, make_audio, run_jobs):
    audio = make_audio("l/1.mp3", title="Song", artist="A", album="L", lyrics="from the tags")

    async def rescan() -> tuple[int, str | None]:
        await client.post("/library/scan", headers=admin)
        jobs = await run_jobs()
        tracks = (await client.get("/tracks", headers=admin)).json()["items"]
        lyrics = (await client.get(f"/tracks/{tracks[0]['id']}/lyrics", headers=admin)).json()
        return jobs, lyrics["plain"]

    assert (await rescan())[1] == "from the tags"
    sidecar = audio.with_suffix(".lrc")
    sidecar.write_text("[00:01.00]first", encoding="utf-8")
    # The scan and the lyrics; the audio file is unchanged, so it isn't imported again.
    assert await rescan() == (2, "first")
    assert await rescan() == (1, "first")

    sidecar.write_text("[00:01.00]second", encoding="utf-8")
    later = time.time() + 2
    os.utime(sidecar, (later, later))
    assert await rescan() == (2, "second")

    sidecar.unlink()
    assert await rescan() == (2, "from the tags")


async def test_lrclib_away_makes_lookups_wait_not_fail(
    client, admin, make_audio, run_jobs, settings, lrclib_responses, sessionmaker
):
    settings.lrclib_enabled = True
    for title in ("Song", "Other"):
        lrclib_responses[title] = httpx.ConnectError("no route to host")
    make_audio("l/1.mp3", title="Song", artist="A", album="L")
    make_audio("l/2.mp3", title="Other", artist="A", album="L")
    await client.post("/library/scan", headers=admin)
    await run_jobs()

    async with sessionmaker() as session:
        lookups = list(await session.scalars(select(Job).where(Job.kind == "fetch_lyrics")))
    # Both wait for LRCLIB to be back: neither failed nor lost a try.
    assert {(j.status, j.attempts) for j in lookups} == {(JobStatus.queued, 0)}
    assert all(j.run_after > utcnow() + timedelta(minutes=4) for j in lookups)
    assert lyrics_fetch.breaker.until is not None


async def test_lyrics_found_once_stay_when_a_new_name_isnt_found(
    client, admin, make_audio, run_jobs, settings, lrclib_responses
):
    settings.lrclib_enabled = True
    lrclib_responses["Song"] = httpx.Response(
        200, json={"syncedLyrics": None, "plainLyrics": "words", "instrumental": False}
    )
    make_audio("l/1.mp3", title="Song", artist="A", album="L")
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    album = (await client.get("/albums", headers=admin)).json()["items"][0]
    track = (await client.get("/tracks", headers=admin)).json()["items"][0]
    del lrclib_responses["Song"]  # LRCLIB doesn't know it under the album's new name

    resp = await client.patch(f"/albums/{album['id']}", json={"title": "Renamed"}, headers=admin)
    assert resp.status_code == 200, resp.text
    await run_jobs()
    lyrics = (await client.get(f"/tracks/{track['id']}/lyrics", headers=admin)).json()
    assert (lyrics["source"], lyrics["plain"]) == ("lrclib", "words")


async def test_edits_that_dont_change_names_dont_look_lyrics_up(
    client, admin, make_audio, run_jobs, sessionmaker
):
    make_audio("l/1.mp3", title="Song", artist="A", album="L", genre="Rock")
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    album = (await client.get("/albums", headers=admin)).json()["items"][0]

    await client.patch("/genres", params={"genre": "Rock"}, json={"name": "Jazz"}, headers=admin)
    await client.patch(f"/albums/{album['id']}", json={"year": 1999}, headers=admin)
    async with sessionmaker() as session:
        queued = await session.scalar(
            select(func.count())
            .select_from(Job)
            .where(Job.kind == "fetch_lyrics", Job.status == JobStatus.queued)
        )
    assert queued == 0
