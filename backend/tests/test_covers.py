from PIL import Image, ImageDraw
from sqlalchemy import update

from app.library.covers import compute_palette
from app.library.models import Cover


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
