"""Playlists, likes, play history, home feed, search and lyrics."""

import httpx
import pytest


@pytest.fixture
async def catalog(client, admin, make_audio, run_jobs) -> dict[str, dict]:
    make_audio("k/1.mp3", title="A Line in the Dust", artist="Katatonia", album="Night", track=1)
    make_audio("k/2.mp3", title="Lethean", artist="Katatonia", album="Night", track=2)
    make_audio("c/1.mp3", title="Dissolution", artist="The Cure", album="Faith", track=1)
    make_audio("a/1.mp3", title="Solitude", artist="Mare Cognitum", album="Solar", track=1)
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
    assert any(a["liked"] for a in home["new_releases"])
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
    assert {a["title"] for a in home["new_releases"]} == {"Night", "Faith", "Solar"}
    assert [a["title"] for a in home["recently_played"]] == ["Faith", "Night"]
    # Played albums are excluded from "for you"; the unplayed one fills in.
    assert [a["title"] for a in home["for_you"]] == ["Solar"]


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
