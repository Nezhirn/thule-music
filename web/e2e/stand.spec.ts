import { expect, test, type Response } from "./test";
import { ADMIN, login, signIn } from "./api";
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

test("the server serves the app as in production", async ({ page, request }) => {
  await signIn(page, ADMIN);
  const assets: Response[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/assets/")) assets.push(response);
  });
  // A page of the app opened by its address: the server answers with the app.
  const document = await page.goto("/albums");
  const headers = await document!.allHeaders();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["cache-control"]).toBe("no-cache");
  await expect(page.getByRole("heading", { level: 1, name: "Albums" })).toBeVisible();

  // The build's files: compressed in advance, cached for good.
  expect(assets.length).toBeGreaterThanOrEqual(3);
  for (const asset of assets) {
    const { "content-encoding": encoding, "cache-control": cache } = await asset.allHeaders();
    expect(cache, asset.url()).toBe("public, max-age=31536000, immutable");
    expect(encoding, asset.url()).toBe("br");
  }

  expect((await request.get("/favicon.svg")).headers()["content-type"]).toBe("image/svg+xml");
  for (const path of ["/assets/gone-1234.js", "/api/v1/no-such-thing"]) {
    const missing = await request.get(path);
    expect(missing.status(), path).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
  }
});
