"""Admins managing artists and genres: albums uploaded for an artist or given to another,
artists deleted, genres renamed, merged, given to albums or taken off. In the files, as the
rest of the management (test_manage)."""

from pathlib import Path

from app.library.tags import read_tags
from tests.test_manage import album, albums, scan, unchanged


async def artists(client, headers) -> dict[str, dict]:
    items = (await client.get("/artists?limit=100", headers=headers)).json()["items"]
    return {a["name"]: a for a in items}


async def genres(client, headers) -> dict[str, int]:
    return {
        g["name"]: g["album_count"] for g in (await client.get("/genres", headers=headers)).json()
    }


async def test_uploading_an_album_for_an_artist(
    client, admin, make_audio, run_jobs, settings, tmp_path
):
    lib: Path = settings.library_path
    make_audio("Old/01.mp3", title="Old Song", artist="A", album="Old", track=1, year=1999)
    await scan(client, admin, run_jobs)
    artist = (await artists(client, admin))["A"]
    url = f"/artists/{artist['id']}/tracks"
    one = make_audio("../outside/one.flac", title="One", artist="", album="Elsewhere")
    two = make_audio("../outside/two.mp3", title="Two", artist="B", album="", track=5)

    form = {"album": " Fresh: Start ", "year": "2021", "genre": "Jazz"}
    resp = await client.post(
        url, data=form, files={"file": ("1.flac", one.read_bytes())}, headers=admin
    )
    assert resp.status_code == 201, resp.text
    first = resp.json()["track"]
    assert (first["title"], first["track_no"], first["artist"]["name"]) == ("One", 1, "A")
    fresh = await album(client, admin, first["album"]["id"])
    assert (fresh["title"], fresh["year"], fresh["genre"], fresh["artist"]["id"]) == (
        "Fresh: Start",
        2021,
        "Jazz",
        artist["id"],
    )
    saved = lib / "A" / "Fresh_ Start" / "1.flac"
    tags = read_tags(saved)
    assert (tags.album, tags.album_artist, tags.year, tags.genre) == (
        "Fresh: Start",
        "A",
        2021,
        "Jazz",
    )

    # The same title again: into that album, beside its first file, with its tags.
    resp = await client.post(
        url,
        data={"album": "fresh: start"},
        files={"file": ("2.mp3", two.read_bytes())},
        headers=admin,
    )
    second = resp.json()["track"]
    assert second["album"]["id"] == first["album"]["id"]
    assert (second["artist"]["name"], second["track_no"]) == ("B", 5)
    assert read_tags(lib / "A" / "Fresh_ Start" / "2.mp3").year == 2021
    await run_jobs()
    assert unchanged(await scan(client, admin, run_jobs))

    # A file the library has: not kept, nor the folder made for it.
    again = await client.post(
        url, data={"album": "Ghost"}, files={"file": ("x.flac", saved.read_bytes())}, headers=admin
    )
    assert again.json()["duplicate"] is True and again.json()["track"]["id"] == first["id"]
    assert not (lib / "A" / "Ghost").exists()
    broken = await client.post(
        url, data={"album": "Ghost"}, files={"file": ("x.mp3", b"no")}, headers=admin
    )
    assert broken.json()["code"] == "not_an_audio_file"
    assert not (lib / "A" / "Ghost").exists()
    assert (lib / "Old" / "01.mp3").is_file()

    no_title = await client.post(
        url, data={"album": "  "}, files={"file": ("y.mp3", b"x")}, headers=admin
    )
    assert no_title.status_code == 422
    nobody = await client.post(
        "/artists/00000000-0000-0000-0000-000000000000/tracks",
        data={"album": "X"},
        files={"file": ("y.mp3", b"x")},
        headers=admin,
    )
    assert nobody.json()["code"] == "artist_not_found"


async def test_albums_given_to_another_artist(client, admin, user, make_audio, run_jobs, settings):
    lib: Path = settings.library_path
    make_audio("W/One/01.flac", title="Uno", artist="Wrong", album="One", track=1)
    make_audio("W/One/02.flac", title="Duo", artist="Wrong feat. Guest", album="One", track=2)
    make_audio("W/Two/01.mp3", title="Visit", artist="Guest", album="Two", album_artist="Wrong")
    make_audio("O/One/01.mp3", title="Theirs", artist="Other", album="One", track=3)
    await scan(client, admin, run_jobs)
    found = await artists(client, admin)
    wrong = (await client.get(f"/artists/{found['Wrong']['id']}", headers=admin)).json()
    by_title = {a["title"]: a for a in wrong["albums"]}
    await client.put(f"/me/likes/albums/{by_title['Two']['id']}", headers=user)

    resp = await client.post(
        "/albums/move",
        json={"album_ids": [a["id"] for a in wrong["albums"]], "artist": "Right"},
        headers=admin,
    )
    assert resp.status_code == 200, resp.text
    right = resp.json()
    assert (right["name"], right["album_count"]) == ("Right", 2)
    # The same albums, likes and all; the old artist is gone with their last track.
    theirs = (await client.get(f"/artists/{right['id']}", headers=admin)).json()["albums"]
    assert sorted(a["id"] for a in theirs) == sorted(a["id"] for a in by_title.values())
    assert (await album(client, user, by_title["Two"]["id"]))["liked"] is True
    assert (await client.get(f"/artists/{wrong['id']}", headers=admin)).status_code == 404
    one = await album(client, admin, by_title["One"]["id"])
    assert [[a["name"] for a in t["artists"]] for t in one["tracks"]] == [
        ["Right"],
        ["Right", "Guest"],
    ]
    visit = read_tags(lib / "W" / "Two" / "01.mp3")
    assert (visit.artists, visit.album_artist) == (["Guest"], "Right")
    assert unchanged(await scan(client, admin, run_jobs))

    # To an artist with an album of the same title: merged into it.
    other = (await artists(client, admin))["Other"]
    resp = await client.post(
        "/albums/move",
        json={"album_ids": [by_title["One"]["id"]], "artist": "Other"},
        headers=admin,
    )
    assert resp.json()["id"] == other["id"]
    merged = (await client.get(f"/artists/{other['id']}", headers=admin)).json()["albums"]
    assert [a["title"] for a in merged] == ["One"]
    tracks = (await album(client, admin, merged[0]["id"]))["tracks"]
    assert [t["title"] for t in tracks] == ["Uno", "Duo", "Theirs"]
    assert (await client.get(f"/albums/{by_title['One']['id']}", headers=admin)).status_code == 404
    assert unchanged(await scan(client, admin, run_jobs))

    unknown = await client.post(
        "/albums/move",
        json={"album_ids": ["00000000-0000-0000-0000-000000000000"], "artist": "X"},
        headers=admin,
    )
    assert unknown.json()["code"] == "unknown_albums"
    listener = await client.post(
        "/albums/move", json={"album_ids": [merged[0]["id"]], "artist": "X"}, headers=user
    )
    assert listener.status_code == 403


async def test_deleting_an_artist(client, admin, user, make_audio, run_jobs, settings):
    lib: Path = settings.library_path
    make_audio("X/Own/01.flac", title="Mine", artist="X", album="Own", track=1)
    make_audio("X/Own/02.flac", title="Guest Spot", artist="G", album="Own", album_artist="X")
    make_audio("VA/01.mp3", title="On It", artist="X", album="Hits", album_artist="Various Artists")
    make_audio("VA/02.mp3", title="Kept", artist="K", album="Hits", album_artist="Various Artists")
    duet = make_audio("Y/01.flac", title="Song (feat. X)", artist="Y feat. X & Z", album="Y1")
    await scan(client, admin, run_jobs)
    found = await artists(client, admin)
    await client.put(f"/me/likes/artists/{found['X']['id']}", headers=user)

    resp = await client.delete(f"/artists/{found['X']['id']}", headers=admin)
    assert resp.status_code == 204, resp.text
    assert not (lib / "X").exists()
    assert sorted(p.name for p in (lib / "VA").iterdir()) == ["02.mp3"]
    # Featuring them: the track stays, without their name.
    tags = read_tags(duet)
    assert (tags.title, tags.artists) == ("Song", ["Y", "Z"])
    assert (await client.get(f"/artists/{found['X']['id']}", headers=admin)).status_code == 404
    assert set(await artists(client, admin)) == {"K", "Various Artists", "Y", "Z"}
    assert set(await albums(client, admin)) == {"Hits", "Y1"}
    assert (await client.get("/me/likes/artists", headers=user)).json()["items"] == []
    assert unchanged(await scan(client, admin, run_jobs))

    again = await client.delete(f"/artists/{found['X']['id']}", headers=admin)
    assert again.json()["code"] == "artist_not_found"
    listener = await client.delete(f"/artists/{found['Y']['id']}", headers=user)
    assert listener.status_code == 403


async def test_genres_renamed_merged_given_and_taken_off(
    client, admin, user, make_audio, run_jobs, settings
):
    lib: Path = settings.library_path
    a1 = make_audio("A/01.mp3", title="A1", artist="A", album="Al", genre="Rock")
    # No genre of its own: the album's is written into it too.
    a2 = make_audio("A/02.flac", title="A2", artist="A", album="Al")
    b1 = make_audio("B/01.flac", title="B1", artist="B", album="Bl", genre="rock")
    c1 = make_audio("C/01.ogg", title="C1", artist="C", album="Cl", genre="Jazz")
    await scan(client, admin, run_jobs)
    assert await genres(client, admin) == {"Rock": 2, "Jazz": 1}

    # Spellings differing in case are one genre; all of its albums' tracks get the new name.
    resp = await client.patch("/genres?genre=ROCK", json={"name": " Classic Rock "}, headers=admin)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"name": "Classic Rock", "album_count": 2}
    assert {read_tags(p).genre for p in (a1, a2, b1)} == {"Classic Rock"}
    assert await genres(client, admin) == {"Classic Rock": 2, "Jazz": 1}
    assert unchanged(await scan(client, admin, run_jobs))

    # The name of another genre: merged.
    resp = await client.patch("/genres?genre=Jazz", json={"name": "Classic Rock"}, headers=admin)
    assert resp.json() == {"name": "Classic Rock", "album_count": 3}
    assert read_tags(c1).genre == "Classic Rock"

    # Albums moved into a genre, new or not.
    found = await albums(client, admin)
    resp = await client.post(
        "/albums/genre",
        json={"album_ids": [found["Cl"]["id"], found["Bl"]["id"]], "genre": "Blues"},
        headers=admin,
    )
    assert resp.json() == {"name": "Blues", "album_count": 2}
    assert read_tags(b1).genre == "Blues" and read_tags(a1).genre == "Classic Rock"
    assert await genres(client, admin) == {"Blues": 2, "Classic Rock": 1}
    assert unchanged(await scan(client, admin, run_jobs))

    # Taken off: the albums stay, without a genre.
    resp = await client.delete("/genres?genre=blues&albums=keep", headers=admin)
    assert resp.status_code == 204
    assert read_tags(b1).genre is None and read_tags(c1).genre is None
    assert (await album(client, admin, found["Bl"]["id"]))["genre"] is None
    assert await genres(client, admin) == {"Classic Rock": 1}
    assert unchanged(await scan(client, admin, run_jobs))

    # With the albums' files.
    resp = await client.delete("/genres?genre=Classic%20Rock&albums=delete", headers=admin)
    assert resp.status_code == 204
    assert not (lib / "A").exists() and set(await albums(client, admin)) == {"Bl", "Cl"}
    assert await genres(client, admin) == {}
    assert unchanged(await scan(client, admin, run_jobs))

    gone = await client.patch("/genres?genre=Classic Rock", json={"name": "X"}, headers=admin)
    assert gone.json()["code"] == "genre_not_found"
    no_choice = await client.delete("/genres?genre=Classic Rock", headers=admin)
    assert no_choice.status_code == 422
    listener = await client.patch("/genres?genre=X", json={"name": "Y"}, headers=user)
    assert listener.status_code == 403
