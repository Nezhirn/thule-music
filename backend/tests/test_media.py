from sqlalchemy import delete

from app.library.models import TrackFile


async def one_track(client, admin, make_audio, run_jobs) -> dict:
    make_audio("a/1.mp3", title="T", artist="A", album="X", duration=3)
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    return (await client.get("/tracks", headers=admin)).json()["items"][0]


def path_and_query(url: str) -> str:
    assert url.startswith("/api/v1/tracks/"), url  # relative to the server, no host
    return url.removeprefix("/api/v1")


async def test_stream_original_supports_range(client, admin, make_audio, run_jobs, settings):
    track = await one_track(client, admin, make_audio, run_jobs)
    full = await client.get(f"/tracks/{track['id']}/stream?quality=original", headers=admin)
    assert full.status_code == 200
    assert full.headers["content-type"] == "audio/mpeg"
    assert full.headers["accept-ranges"] == "bytes"
    size = (settings.library_path / "a/1.mp3").stat().st_size
    assert len(full.content) == size

    part = await client.get(
        f"/tracks/{track['id']}/stream?quality=original",
        headers={**admin, "Range": "bytes=0-1023"},
    )
    assert part.status_code == 206
    assert part.headers["content-range"] == f"bytes 0-1023/{size}"
    assert part.content == full.content[:1024]


async def test_transcoded_variants_are_served(client, admin, make_audio, run_jobs):
    track = await one_track(client, admin, make_audio, run_jobs)
    for quality in ("high", "low"):
        resp = await client.get(f"/tracks/{track['id']}/stream?quality={quality}", headers=admin)
        assert resp.status_code == 200
        assert resp.headers["x-thule-quality"] == quality
        assert resp.headers["content-type"].startswith("audio/ogg")
        assert resp.content[:4] == b"OggS"


async def test_signed_url_plays_without_auth(client, admin, make_audio, run_jobs):
    track = await one_track(client, admin, make_audio, run_jobs)
    assert (await client.get(f"/tracks/{track['id']}/stream")).status_code == 401

    signed = (await client.get(f"/tracks/{track['id']}/stream-url", headers=admin)).json()
    assert signed["quality"] == "high"
    resp = await client.get(path_and_query(signed["url"]))
    assert resp.status_code == 200
    assert resp.headers["x-thule-quality"] == "high"

    # Tampering with quality or signature is rejected.
    tampered = path_and_query(signed["url"]).replace("quality=high", "quality=original")
    assert (await client.get(tampered)).status_code == 401
    bad_sig = path_and_query(signed["url"]).replace("sig=", "sig=x")
    assert (await client.get(bad_sig)).status_code == 401


async def test_signed_url_is_pinned_to_original_until_transcoded(
    client, admin, make_audio, run_jobs, sessionmaker
):
    track = await one_track(client, admin, make_audio, run_jobs)
    async with sessionmaker() as session:
        await session.execute(delete(TrackFile))
        await session.commit()
    signed = (await client.get(f"/tracks/{track['id']}/stream-url", headers=admin)).json()
    assert signed["quality"] == "original"
    resp = await client.get(path_and_query(signed["url"]))
    assert resp.headers["x-thule-quality"] == "original"


async def test_cover_sizes(client, admin, make_audio, run_jobs):
    make_audio("a/1.mp3", title="T", artist="A", album="X", cover=(1, 2, 3))
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    album = (await client.get("/albums", headers=admin)).json()["items"][0]
    for size in ("", "?size=64", "?size=300", "?size=600"):
        resp = await client.get(f"/covers/{album['cover_id']}{size}")
        assert resp.status_code == 200
        assert "immutable" in resp.headers["cache-control"]
    assert (await client.get(f"/covers/{album['cover_id']}?size=65")).status_code == 422
