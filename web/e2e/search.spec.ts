// Search against the real server: as you type, by kind, misspelt, from the keyboard; and
// the lyrics of the playing track.
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import { createUser, signIn } from "./api";

const bar = (page: Page) => page.getByRole("region", { name: "Player" });
const field = (page: Page) => page.getByRole("searchbox", { name: "Search the library" });

test.beforeEach(async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, await createUser(baseURL!));
});

test("search as you type: the top result, tracks, artists, albums", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // "/" from anywhere: the field, in focus.
  await page.keyboard.press("/");
  await expect(page).toHaveURL("/search");
  await expect(field(page)).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Browse by genre" })).toBeVisible();
  await expectAccessible(page);

  await page.keyboard.type("aurora", { delay: 40 });
  await expect(page).toHaveURL("/search?q=aurora");
  const top = page.getByRole("region", { name: "Top result" });
  await expect(top.getByRole("link", { name: "Aurora Fields" })).toBeVisible();
  await expect(top).toContainText("Artist");
  // "Slow Aurora" by its title, the others by their artist's name.
  await expect(page.getByRole("table", { name: "Tracks" }).locator("tbody tr")).toHaveCount(5);
  await expect(
    page.getByRole("region", { name: "Albums" }).getByRole("link", { name: "Northern Lights" }),
  ).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "For “aurora”" })).toHaveText(
    "For “aurora”: 1 artist, 2 albums, 6 tracks",
  );
  await expectAccessible(page);

  await top.getByRole("button", { name: "Play Aurora Fields" }).click();
  await expect(bar(page).getByRole("button", { name: "Pause" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Pause" }).click();

  // One kind; the address keeps it, so back returns to it.
  await page.getByRole("radio", { name: "Albums" }).check();
  await expect(page).toHaveURL("/search?q=aurora&type=albums");
  const albums = page.getByRole("list", { name: "Albums" });
  await expect(albums.getByRole("link", { name: "Polar Night" })).toBeVisible();
  await albums.getByRole("link", { name: "Polar Night" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Polar Night" })).toBeVisible();
  await page.goBack();
  await expect(field(page)).toHaveValue("aurora");
  await expect(page.getByRole("radio", { name: "Albums" })).toBeChecked();
  await expect(albums.getByRole("link", { name: "Polar Night" })).toBeVisible();
});

test("misspelt words are found; nothing found says so", async ({ page }) => {
  await page.goto("/search");
  await field(page).fill("glas harbr");
  const top = page.getByRole("region", { name: "Top result" });
  await expect(top.getByRole("link", { name: "The Glass Harbor" })).toBeVisible();

  await field(page).fill("qwxz");
  await expect(page.getByText("Nothing found for “qwxz”", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Clear the search" }).click();
  await expect(page).toHaveURL("/search");
  await expect(field(page)).toBeFocused();
});

test("a track's lyrics: from a file beside it, from its tags, or none", async ({ page }) => {
  await page.goto("/albums?sort=title");
  await page.getByRole("link", { name: "Northern Lights", exact: true }).click();
  await page.getByRole("button", { name: "Play Northern Lights" }).click();
  await bar(page).getByRole("button", { name: "Lyrics" }).click();
  await expect(page).toHaveURL("/lyrics");
  await expect(page.getByRole("heading", { level: 1, name: "Polar Drift" })).toBeVisible();
  const words = page.getByRole("region", { name: "Lyrics" });
  // The .lrc file's lines, without their times.
  await expect(words.getByRole("paragraph")).toHaveText([
    "Snow on the railsLights in the north",
    "We drift until morning",
    "From a file next to the track",
  ]);
  await expectAccessible(page);

  await bar(page).getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Glass Sky" })).toBeVisible();
  await expect(words.getByRole("paragraph")).toHaveText([
    "Under a glass skyNothing to hide",
    "From the track's tags",
  ]);
  await bar(page).getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Slow Aurora" })).toBeVisible();
  await expect(page.getByText("No lyrics for this track")).toBeVisible();
  await bar(page).getByRole("button", { name: "Pause" }).click();

  await bar(page).getByRole("button", { name: "Lyrics" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Northern Lights" })).toBeVisible();
});

test("phones: search from its tab, lyrics in the full player", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Search" })
    .click();
  await field(page).fill("polar");
  await expect(
    page.getByRole("table", { name: "Tracks" }).locator("tbody tr").first(),
  ).toBeVisible();
  await expectAccessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await page
    .getByRole("region", { name: "Top result" })
    .getByRole("button", { name: /^Play/ })
    .click();
  await bar(page)
    .getByRole("button", { name: /Open the player/ })
    .click();
  const player = page.getByRole("dialog", { name: "Now playing" });
  await player.getByRole("button", { name: "Lyrics" }).click();
  await expect(player.getByRole("region", { name: "Lyrics" })).toBeVisible();
  await expectAccessible(page);
});
