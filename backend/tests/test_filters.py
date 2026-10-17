"""The long lists filtered by artist, album and genre, and the choices each filter offers."""

import pytest


async def scan(client, admin, run_jobs) -> None:
    assert (await client.post("/library/scan", headers=admin)).status_code == 202
    await run_jobs()


@pytest.fixture
async def library(client, admin, make_audio, run_jobs) -> dict[str, dict]:
    """Two albums by Hurt In Lane (one genre, spelled two ways; a guest on one), one by
    Mila, a compilation Hurt In Lane is on. Returns the artists and albums by name."""
    fake = {"album": "Fake Truth", "year": 2018, "genre": "Metalcore"}
    make_audio("H/F/01.mp3", title="Intro", artist="Hurt In Lane", track=1, **fake)
    make_audio("H/F/02.mp3", title="Despair", artist="Hurt In Lane", track=2, **fake)
    make_audio("H/F/03.mp3", title="Mob Law", artist="Hurt In Lane feat. Mila", track=3, **fake)
    make_audio(
        "H/O/01.mp3", title="Путь", artist="Hurt In Lane", album="Обитель", genre="metalcore"
    )
    make_audio("M/S/01.mp3", title="Solo", artist="Mila", album="Solo", genre="Pop")
    make_audio(
        "VA/B/01.mp3",
        title="Choice",
        artist="Hurt In Lane",
        album="Best Of",
        album_artist="Various Artists",
        genre="Rock",
    )
    await scan(client, admin, run_jobs)
    artists = (await client.get("/artists", headers=admin)).json()["items"]
    albums = (await client.get("/albums", headers=admin)).json()["items"]
    return {a["name"]: a for a in artists} | {a["title"]: a for a in albums}


async def titles(client, headers, url: str) -> tuple[list[str], int]:
    page = (await client.get(url, headers=headers)).json()
    return sorted(t.get("title") or t["name"] for t in page["items"]), page["total"]


async def test_tracks_filtered(client, admin, library):
    hil, mila = library["Hurt In Lane"]["id"], library["Mila"]["id"]
    # Credited, or on their album.
    assert await titles(client, admin, f"/tracks?artist_id={hil}") == (
        ["Choice", "Despair", "Intro", "Mob Law", "Путь"],
        5,
    )
    assert await titles(client, admin, f"/tracks?artist_id={mila}") == (["Mob Law", "Solo"], 2)
    # Spellings differing in case are one genre.
    assert await titles(client, admin, "/tracks?genre=METALCORE") == (
        ["Despair", "Intro", "Mob Law", "Путь"],
        4,
    )
    fake = library["Fake Truth"]["id"]
    assert await titles(client, admin, f"/tracks?album_id={fake}&artist_id={mila}") == (
        ["Mob Law"],
        1,
    )
    assert await titles(client, admin, f"/tracks?genre=Pop&artist_id={hil}") == ([], 0)
    # Sorted as asked, the filters kept.
    page = (await client.get(f"/tracks?artist_id={hil}&sort=title", headers=admin)).json()
    assert [t["title"] for t in page["items"]] == ["Choice", "Despair", "Intro", "Mob Law", "Путь"]


async def test_albums_and_artists_filtered(client, admin, library):
    hil = library["Hurt In Lane"]["id"]
    # Their own albums: not the compilation they are on.
    assert await titles(client, admin, f"/albums?artist_id={hil}") == (
        ["Fake Truth", "Обитель"],
        2,
    )
    assert await titles(client, admin, f"/albums?artist_id={hil}&genre=metalcore") == (
        ["Fake Truth", "Обитель"],
        2,
    )
    # With an album of the genre, their own or one they are credited on.
    assert await titles(client, admin, "/artists?genre=rock") == (
        ["Hurt In Lane", "Various Artists"],
        2,
    )
    assert await titles(client, admin, "/artists?genre=Metalcore") == (["Hurt In Lane", "Mila"], 2)


async def test_liked_lists_filtered(client, admin, user, library):
    hil = library["Hurt In Lane"]["id"]
    tracks = {
        t["title"]: t["id"] for t in (await client.get("/tracks", headers=admin)).json()["items"]
    }
    for title in ("Despair", "Solo", "Choice"):
        await client.put(f"/me/likes/tracks/{tracks[title]}", headers=user)
    for album in ("Fake Truth", "Solo", "Best Of"):
        await client.put(f"/me/likes/albums/{library[album]['id']}", headers=user)
    for artist in ("Hurt In Lane", "Mila"):
        await client.put(f"/me/likes/artists/{library[artist]['id']}", headers=user)

    assert await titles(client, user, f"/me/likes/tracks?artist_id={hil}") == (
        ["Choice", "Despair"],
        2,
    )
    assert await titles(client, user, "/me/likes/tracks?genre=pop") == (["Solo"], 1)
    assert await titles(client, user, f"/me/likes/albums?artist_id={hil}") == (["Fake Truth"], 1)
    assert await titles(client, user, "/me/likes/albums?genre=Rock") == (["Best Of"], 1)
    assert await titles(client, user, "/me/likes/artists?genre=Pop") == (["Mila"], 1)
    # Someone else's likes are not in them.
    assert await titles(client, admin, "/me/likes/tracks?genre=pop") == ([], 0)


def options(body: dict) -> list[tuple]:
    return [(o["name"], o["count"]) for o in body["items"]]


async def test_artist_choices(client, admin, user, library):
    page = (await client.get("/filters/artists?scope=tracks", headers=admin)).json()
    assert options(page) == [("Hurt In Lane", 5), ("Mila", 2), ("Various Artists", 1)]
    assert page["total"] == 3 and page["selected"] is None

    # The other filters set; its own not.
    mila = library["Mila"]["id"]
    page = (
        await client.get(
            f"/filters/artists?scope=tracks&genre=metalcore&artist_id={mila}", headers=admin
        )
    ).json()
    assert options(page) == [("Hurt In Lane", 4), ("Mila", 1)]
    assert page["selected"] == {"value": mila, "name": "Mila", "detail": None}

    # Of albums: the album artists.
    page = (await client.get("/filters/artists?scope=albums&q=lane", headers=admin)).json()
    assert options(page) == [("Hurt In Lane", 2)]

    # Of the user's own likes only.
    await client.put(f"/me/likes/albums/{library['Solo']['id']}", headers=user)
    page = (await client.get("/filters/artists?scope=liked_albums", headers=user)).json()
    assert options(page) == [("Mila", 1)]
    page = (await client.get("/filters/artists?scope=liked_tracks", headers=user)).json()
    assert (options(page), page["total"]) == ([], 0)

    # Only named: nothing counted.
    page = (
        await client.get(f"/filters/artists?scope=tracks&artist_id={mila}&limit=0", headers=admin)
    ).json()
    assert page == {
        "items": [],
        "total": 0,
        "selected": {"value": mila, "name": "Mila", "detail": None},
    }

    resp = await client.get("/filters/artists?scope=artists", headers=admin)
    assert (resp.status_code, resp.json()["code"]) == (422, "validation_error")


async def test_album_choices(client, admin, library):
    hil = library["Hurt In Lane"]["id"]
    page = (await client.get(f"/filters/albums?scope=tracks&artist_id={hil}", headers=admin)).json()
    assert [(o["name"], o["detail"], o["count"]) for o in page["items"]] == [
        ("Best Of", "Various Artists", 1),
        ("Fake Truth", "Hurt In Lane", 3),
        ("Обитель", "Hurt In Lane", 1),
    ]
    # `q` matches the album's artist too; one at a time.
    page = (await client.get("/filters/albums?scope=tracks&q=mila&limit=1", headers=admin)).json()
    assert (options(page), page["total"]) == ([("Solo", 1)], 1)
    fake = library["Fake Truth"]["id"]
    page = (
        await client.get(f"/filters/albums?scope=tracks&q=zzz&album_id={fake}", headers=admin)
    ).json()
    assert page["items"] == []
    assert page["selected"] == {"value": fake, "name": "Fake Truth", "detail": "Hurt In Lane"}

    resp = await client.get("/filters/albums?scope=albums", headers=admin)
    assert resp.status_code == 422


async def test_genre_choices(client, admin, library):
    page = (await client.get("/filters/genres?scope=tracks", headers=admin)).json()
    # The most tracks first; one spelling of each.
    assert options(page) == [("Metalcore", 4), ("Pop", 1), ("Rock", 1)]
    page = (await client.get("/filters/genres?scope=albums", headers=admin)).json()
    assert options(page) == [("Metalcore", 2), ("Pop", 1), ("Rock", 1)]
    page = (await client.get("/filters/genres?scope=artists", headers=admin)).json()
    assert options(page) == [("Metalcore", 2), ("Rock", 2), ("Pop", 1)]

    mila = library["Mila"]["id"]
    page = (
        await client.get(
            f"/filters/genres?scope=tracks&artist_id={mila}&genre=METALCORE&q=core",
            headers=admin,
        )
    ).json()
    assert options(page) == [("Metalcore", 1)]
    assert page["selected"]["name"] == "Metalcore"
