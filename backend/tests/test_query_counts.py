"""Each query is a round trip to the database, tens of milliseconds to a remote one: the
pages ask few, however many albums and tracks they show."""

import pytest
from sqlalchemy import event


@pytest.fixture
async def library(client, admin, make_audio, run_jobs) -> dict:
    for artist in ("A", "B", "C"):
        for album in ("X", "Y"):
            for n in (1, 2, 3):
                make_audio(
                    f"{artist}/{album}/{n}.mp3",
                    title=f"{artist}{album}{n}",
                    artist=f"{artist} feat. Guest" if n == 2 else artist,
                    album=f"{artist} {album}",
                    track=n,
                    year=2000 + n,
                    cover=(n * 40, 9, 9),
                )
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    tracks = (await client.get("/tracks?limit=50", headers=admin)).json()["items"]
    for track in tracks[:6]:
        await client.put(f"/me/likes/tracks/{track['id']}", headers=admin)
        await client.post("/me/plays", json={"track_id": track["id"]}, headers=admin)
    playlist = (await client.post("/playlists", json={"name": "P"}, headers=admin)).json()
    await client.post(
        f"/playlists/{playlist['id']}/tracks",
        json={"track_ids": [t["id"] for t in tracks]},
        headers=admin,
    )
    return {"track": tracks[0], "playlist": playlist}


@pytest.fixture
def statements(engine):
    seen: list[str] = []

    def count(conn, cursor, statement, parameters, context, executemany):
        seen.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", count)
    yield seen
    event.remove(engine.sync_engine, "before_cursor_execute", count)


# Statements at most per page, however many albums and tracks it shows.
PAGES = {
    "/home": 8,
    "/artists/{artist}": 11,
    "/albums/{album}": 7,
    "/albums?limit=50": 5,
    "/tracks?limit=50": 6,
    "/artists?limit=50": 8,
    "/search?q=A": 10,  # three kinds, each with its likes
    "/me/recent": 5,
    "/me/likes/tracks": 5,
    "/me/history": 6,
    "/playlists/{playlist}": 9,
    "/tracks/{track}/stream-url": 3,
}


async def test_pages_ask_the_database_little(client, admin, library, statements):
    track = library["track"]
    over = {}
    for path, most in PAGES.items():
        url = path.format(
            artist=track["artist"]["id"],
            album=track["album"]["id"],
            track=track["id"],
            playlist=library["playlist"]["id"],
        )
        statements.clear()
        resp = await client.get(url, headers=admin)
        assert resp.status_code == 200, resp.text
        if len(statements) > most:
            over[path] = statements[:]
    assert not over, "\n\n".join(f"{p}: {len(s)}\n" + "\n".join(s) for p, s in over.items())
