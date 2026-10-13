import { expect, test } from "@playwright/test";
import { login } from "./api";
import library from "./stack/library.json" with { type: "json" };

test("the scan imports the generated library", async ({ baseURL }) => {
  const api = await login(baseURL!);
  const { data: albums } = await api.GET("/api/v1/albums", { params: { query: { limit: 100 } } });
  const byTitle = new Map(albums!.items.map((album) => [album.title, album]));
  expect([...byTitle.keys()].sort()).toEqual(library.albums.map((a) => a.title).sort());

  for (const spec of library.albums) {
    const album = byTitle.get(spec.title)!;
    expect(album.artist.name).toBe(spec.artist);
    expect(album.year).toBe(spec.year);
    // Folder images and embedded pictures both become the cover, with a palette to tint by.
    expect(album.cover_id === null).toBe(spec.cover === null);
    if (spec.cover) expect(album.cover_palette?.vibrant).toBeTruthy();
  }
});

test("audio streams through the web origin and plays in the browser", async ({ page, baseURL }) => {
  const api = await login(baseURL!);
  const { data: tracks } = await api.GET("/api/v1/tracks", { params: { query: { limit: 1 } } });
  const track = tracks!.items[0]!;
  const { data: stream } = await api.GET("/api/v1/tracks/{track_id}/stream-url", {
    params: { path: { track_id: track.id } },
  });
  // Transcoded by the worker during the scan, and signed: no Authorization header needed.
  expect(stream!.quality).toBe("high");
  expect(stream!.url).toMatch(/^\/api\/v1\//);

  await page.goto("/");
  const duration = await page.evaluate(async (url) => {
    const audio = new Audio(url);
    await new Promise((resolve, reject) => {
      audio.onloadedmetadata = resolve;
      audio.onerror = () => reject(new Error(`audio error ${audio.error?.code}`));
    });
    return audio.duration;
  }, stream!.url);
  expect(duration).toBeCloseTo(track.duration_ms / 1000, 0);
});
