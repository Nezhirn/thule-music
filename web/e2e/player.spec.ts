// The player against the real server, with real audio: Chromium plays the generated library
// (Opus transcodes of the FLAC and Ogg albums, the MP3s as they are).
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import { createUser, login, signIn, type Account } from "./api";

const bar = (page: Page) => page.getByRole("region", { name: "Player" });
const nowPlaying = (page: Page) => page.getByRole("complementary", { name: "Now playing" });
const upNext = (scope: Locator) =>
  scope.getByRole("list", { name: "Up next" }).getByRole("listitem");

/** Seconds into the track, from the position slider. */
const position = (scope: Locator) =>
  scope.getByRole("slider", { name: "Position" }).inputValue().then(Number);

const mediaSession = (page: Page) =>
  page.evaluate(() => ({
    title: navigator.mediaSession.metadata?.title,
    artist: navigator.mediaSession.metadata?.artist,
    album: navigator.mediaSession.metadata?.album,
    state: navigator.mediaSession.playbackState,
  }));

async function openAlbum(page: Page, title: string) {
  await page.goto("/albums?sort=title");
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

let account: Account;

test.beforeEach(async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  account = await createUser(baseURL!);
  await signIn(page, account);
});

test("plays an album through, and tells the system what plays", async ({ page }) => {
  await openAlbum(page, "Northern Lights");
  await page.getByRole("button", { name: "Play Northern Lights" }).click();

  await expect(bar(page).getByRole("link", { name: "Polar Drift" })).toBeVisible();
  await expect.poll(() => position(bar(page))).toBeGreaterThanOrEqual(1);
  await expect(nowPlaying(page).getByText("Opus · 160 kbps")).toBeVisible();
  await expect(upNext(nowPlaying(page))).toHaveText([/Glass Sky/, /Slow Aurora/, /Shared Sky/]);
  expect(await mediaSession(page)).toEqual({
    title: "Polar Drift",
    artist: "Aurora Fields",
    album: "Northern Lights",
    state: "playing",
  });
  // The playing row.
  const row = page.getByRole("table").getByRole("row", { name: /Polar Drift/ });
  await expect(row).toHaveAttribute("aria-current", "true");

  await bar(page).getByRole("button", { name: "Next" }).click();
  await expect(bar(page).getByRole("link", { name: "Glass Sky" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Previous" }).click();
  await expect(bar(page).getByRole("link", { name: "Polar Drift" })).toBeVisible();

  await bar(page).getByRole("button", { name: "Pause" }).click();
  await expect.poll(() => mediaSession(page).then((s) => s.state)).toBe("paused");
  const paused = await position(bar(page));
  await page.waitForTimeout(1500);
  expect(await position(bar(page))).toBe(paused);
});

test("seeks to the end: the next track plays, repeat plays one again, the end stops", async ({
  page,
}) => {
  await openAlbum(page, "Polar Night"); // MP3s, played as they are
  await page.getByRole("button", { name: "Play Polar Night" }).click();
  const slider = bar(page).getByRole("slider", { name: "Position" });
  await expect(bar(page).getByRole("link", { name: "Midnight Sun" })).toBeVisible();
  await expect.poll(() => position(bar(page))).toBeGreaterThanOrEqual(1);

  await slider.focus();
  await page.keyboard.press("End");
  await expect(bar(page).getByRole("link", { name: "Ice Road" })).toBeVisible();
  await expect.poll(() => position(bar(page))).toBeGreaterThanOrEqual(1);

  await bar(page).getByRole("button", { name: "Repeat: off" }).click();
  await bar(page).getByRole("button", { name: "Repeat: all" }).click();
  await expect(bar(page).getByRole("button", { name: "Repeat: this track" })).toBeVisible();
  await slider.focus();
  await page.keyboard.press("End");
  await expect.poll(() => position(bar(page))).toBeLessThan(5);
  await expect(bar(page).getByRole("link", { name: "Ice Road" })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Pause" })).toBeVisible();

  await bar(page).getByRole("button", { name: "Repeat: this track" }).click();
  await slider.focus();
  await page.keyboard.press("End");
  // The queue is over: back at its start, stopped.
  await expect(bar(page).getByRole("link", { name: "Midnight Sun" })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("queues tracks next and last, and keeps the queue over a reload", async ({ page }) => {
  await openAlbum(page, "Low Tide");
  await page.getByRole("button", { name: "Play Salt" }).click();
  await expect(bar(page).getByRole("link", { name: "Salt" })).toBeVisible();
  await expect(upNext(nowPlaying(page))).toHaveText([/Undertow/]);

  await page.getByRole("button", { name: "More for Harbor Lights" }).click();
  await page.getByRole("menuitem", { name: "Play next" }).click();
  await expect(page.getByRole("status").filter({ hasText: "plays next" })).toHaveText(
    "Harbor Lights plays next",
  );
  await expect(upNext(nowPlaying(page))).toHaveText([/Harbor Lights/, /Undertow/]);

  await nowPlaying(page).getByRole("button", { name: "Remove Undertow from the queue" }).click();
  await expect(upNext(nowPlaying(page))).toHaveText([/Harbor Lights/]);
  await expect.poll(() => position(bar(page))).toBeGreaterThanOrEqual(2);
  await bar(page).getByRole("button", { name: "Pause" }).click();
  const at = await position(bar(page));

  await page.reload();
  await expect(bar(page).getByRole("link", { name: "Salt" })).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
  expect(Math.abs((await position(bar(page))) - at)).toBeLessThanOrEqual(1);
  await expect(upNext(nowPlaying(page))).toHaveText([/Harbor Lights/]);
  await bar(page).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => position(bar(page))).toBeGreaterThan(at + 1);
});

test("a reload while a track starts keeps the place in the queue", async ({ page }) => {
  await openAlbum(page, "Northern Lights");
  // The stream URL is slow to come, and the page is reloaded before it does: the dropped
  // request must not count as a track that can't be played.
  let asked!: () => void;
  const asking = new Promise<void>((resolve) => (asked = resolve));
  await page.route("**/stream-url?*", async (route) => {
    asked();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue().catch(() => {});
  });
  await page.getByRole("button", { name: "Play Northern Lights" }).click();
  await asking;
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.reload();
  await expect(bar(page).getByRole("link", { name: "Polar Drift" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => position(bar(page))).toBeGreaterThan(0);
});

test("a track listened to counts as played, and its album shows on the home page", async ({
  page,
  baseURL,
}) => {
  const api = await login(baseURL!, account);
  const backdrop = page.getByTestId("backdrop");
  const before = await backdrop.evaluate((el) => el.style.getPropertyValue("--ambient-1"));
  await openAlbum(page, "Northern Lights");
  await page.getByRole("button", { name: "Play Northern Lights" }).click();
  // The backdrop takes the cover's colours.
  await expect
    .poll(() => backdrop.evaluate((el) => el.style.getPropertyValue("--ambient-1")))
    .not.toBe(before);

  // Half of the 20 seconds of Polar Drift.
  await expect
    .poll(
      async () =>
        (await api.GET("/api/v1/me/recent")).data?.map((recent) => recent.track.title) ?? [],
      { timeout: 20_000 },
    )
    .toEqual(["Polar Drift"]);
  await page.getByRole("link", { name: "Home" }).first().click();
  const played = page.getByRole("region", { name: "Recently played" });
  await expect(played.getByRole("link", { name: "Northern Lights" })).toBeVisible();
});

test("desktop with something playing passes automated accessibility checks", async ({ page }) => {
  await openAlbum(page, "Deep Water");
  await page.getByRole("button", { name: "Play Deep Water" }).click();
  await expect(bar(page).getByRole("button", { name: "Pause" })).toBeVisible();
  await expectAccessible(page);
  await page
    .getByRole("button", { name: /^More for / })
    .first()
    .click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expectAccessible(page);
});

test("narrower windows open the queue over the page", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await openAlbum(page, "Low Tide");
  await page.getByRole("button", { name: "Play Low Tide" }).click();
  await expect(nowPlaying(page)).toBeHidden();
  const toggle = bar(page).getByRole("button", { name: "Queue" });
  await toggle.click();
  await expect(nowPlaying(page)).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(upNext(nowPlaying(page))).toHaveText([/Salt/, /Undertow/]);
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(nowPlaying(page)).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("phones have a mini player that opens the full player", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAlbum(page, "Northern Lights");
  await page.getByRole("button", { name: "Play Northern Lights" }).click();
  const mini = bar(page);
  await expect(mini.getByText("Polar Drift")).toBeVisible();
  await mini.getByRole("button", { name: /Open the player/ }).click();

  const player = page.getByRole("dialog", { name: "Now playing" });
  await expect(player.getByRole("link", { name: "Polar Drift" })).toBeVisible();
  await expect.poll(() => position(player)).toBeGreaterThanOrEqual(1);
  await expectAccessible(page);
  await player.getByRole("button", { name: "Next" }).click();
  await expect(player.getByRole("link", { name: "Glass Sky" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(player).toBeHidden();
  await expect(mini.getByText("Glass Sky")).toBeVisible();
  await expectAccessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
