from PIL import Image, ImageDraw
from sqlalchemy import update

from app.library.covers import compute_palette
from app.library.models import Cover
from tests.conftest import png_bytes


def test_palette_of_a_dark_cover_with_a_red_accent():
    image = Image.new("RGB", (300, 300), (12, 12, 14))
    ImageDraw.Draw(image).rectangle((100, 100, 160, 160), fill=(210, 30, 40))
    palette = compute_palette(image)
    assert palette["dominant"] == "#0c0c0e"
    assert palette["vibrant"] == "#d21e28"
    assert palette["luminance"] < 0.05


def test_greyscale_cover_has_no_vibrant_colour():
    image = Image.linear_gradient("L").convert("RGB")
    palette = compute_palette(image)
    assert palette["vibrant"] is None
    r, g, b = (int(palette["muted"][i : i + 2], 16) for i in (1, 3, 5))
    assert max(r, g, b) - min(r, g, b) < 10


async def test_api_returns_palettes_and_backfills_old_covers(
    client, admin, make_audio, run_jobs, sessionmaker
):
    make_audio("a/1.mp3", title="T", artist="A", album="X", cover=(30, 60, 200))
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    (track,) = (await client.get("/tracks", headers=admin)).json()["items"]
    palette = track["album"]["cover_palette"]
    assert palette["average"] == "#1e3cc8" and palette["vibrant"] == "#1e3cc8"
    artist = (await client.get("/artists", headers=admin)).json()["items"][0]
    assert artist["cover_palette"] == palette

    # A cover stored before palettes existed: the API falls back to the average colour...
    async with sessionmaker() as session:
        await session.execute(update(Cover).values(palette=None))
        await session.commit()
    album = (await client.get(f"/albums/{track['album']['id']}", headers=admin)).json()
    assert album["cover_palette"]["average"] == "#1e3cc8"
    # ...and the next scan queues a job that computes the real palette.
    await client.post("/library/scan", headers=admin)
    await run_jobs()
    album = (await client.get(f"/albums/{track['album']['id']}", headers=admin)).json()
    assert album["cover_palette"] == palette


async def album_color(client, admin) -> str | None:
    (album,) = (await client.get("/albums", headers=admin)).json()["items"]
    return album["cover_palette"] and album["cover_palette"]["average"]


async def rescan(client, admin, run_jobs) -> None:
    await client.post("/library/scan", headers=admin)
    await run_jobs()


async def test_replaced_or_removed_folder_image_is_picked_up(
    client, admin, make_audio, run_jobs, settings
):
    make_audio("X/01.flac", title="T", artist="A", album="X", cover=(200, 0, 0))  # X/cover.png
    await rescan(client, admin, run_jobs)
    assert await album_color(client, admin) == "#c80000"

    (settings.library_path / "X" / "cover.png").write_bytes(png_bytes((0, 0, 200)))
    await rescan(client, admin, run_jobs)
    assert await album_color(client, admin) == "#0000c8"

    (settings.library_path / "X" / "cover.png").unlink()
    await rescan(client, admin, run_jobs)
    assert await album_color(client, admin) is None


async def test_new_embedded_art_replaces_the_old(client, admin, make_audio, run_jobs):
    make_audio("X/01.mp3", title="T", artist="A", album="X", cover=(200, 0, 0))
    await rescan(client, admin, run_jobs)
    assert await album_color(client, admin) == "#c80000"
    make_audio("X/01.mp3", title="T", artist="A", album="X", cover=(0, 200, 0))
    await rescan(client, admin, run_jobs)
    assert await album_color(client, admin) == "#00c800"


async def test_folder_image_beats_embedded_art(client, admin, make_audio, run_jobs, settings):
    make_audio("X/01.mp3", title="T", artist="A", album="X", cover=(200, 0, 0))
    (settings.library_path / "X" / "folder.png").write_bytes(png_bytes((0, 0, 200)))
    await rescan(client, admin, run_jobs)
    assert await album_color(client, admin) == "#0000c8"
    # Nothing changed: the next scan queues no cover work.
    await client.post("/library/scan", headers=admin)
    assert await run_jobs() == 1


async def test_retagged_track_moves_album_art_along(client, admin, make_audio, run_jobs):
    make_audio("X/01.mp3", title="One", artist="A", album="Old", track=1, cover=(200, 0, 0))
    make_audio("X/02.mp3", title="Two", artist="A", album="Old", track=2, cover=(0, 0, 200))
    await rescan(client, admin, run_jobs)
    (album,) = (await client.get("/albums", headers=admin)).json()["items"]
    assert album["cover_palette"]["average"] == "#c80000"  # the first track's art

    # Track 1 now belongs to another album: "Old" falls back to track 2's art.
    make_audio("X/01.mp3", title="One", artist="A", album="New", track=1, cover=(200, 0, 0))
    await rescan(client, admin, run_jobs)
    albums = (await client.get("/albums?sort=title", headers=admin)).json()["items"]
    assert {a["title"]: a["cover_palette"]["average"] for a in albums} == {
        "New": "#c80000",
        "Old": "#0000c8",
    }

    # And when the last track leaves, the emptied album is gone without errors.
    make_audio("X/02.mp3", title="Two", artist="A", album="New", track=2, cover=(0, 0, 200))
    await rescan(client, admin, run_jobs)
    albums = (await client.get("/albums", headers=admin)).json()["items"]
    assert [a["title"] for a in albums] == ["New"]
    jobs = (await client.get("/library/jobs?status=failed", headers=admin)).json()
    assert jobs["items"] == []
