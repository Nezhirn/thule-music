// The user's own music against the real server: likes and favourites, playlists, history.
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible } from "./a11y";
import { createUser, login, signIn, type Account } from "./api";

const bar = (page: Page) => page.getByRole("region", { name: "Player" });
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const rows = (page: Page) => page.getByRole("table").locator("tbody tr:not(:has(th))");

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

test("songs are liked, albums and artists kept in Favourites", async ({ page, baseURL }) => {
  await openAlbum(page, "Northern Lights");
  const heart = page.getByRole("button", { name: "Like Polar Drift" });
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expect(toast(page, "Liked songs")).toHaveText("Polar Drift is in Liked songs");
  await page.getByRole("button", { name: "More for Glass Sky" }).click();
  await page.getByRole("menuitem", { name: "Add to Liked songs" }).click();
  await page.getByRole("button", { name: "Favourite" }).click();
  await expect(toast(page, "Favourites")).toHaveText("Northern Lights is in Favourites");

  await page.getByRole("main").getByRole("link", { name: "Aurora Fields" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Aurora Fields" })).toBeVisible();
  await page.getByRole("button", { name: "Favourite" }).click();
  await expect(page.getByRole("button", { name: "Favourite" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The server has them.
  const api = await login(baseURL!, account);
  await expect.poll(async () => (await api.GET("/api/v1/me/likes/artists")).data?.total).toBe(1);
  const liked = await api.GET("/api/v1/me/likes/tracks");
  expect(liked.data?.items.map((track) => track.title)).toEqual(["Glass Sky", "Polar Drift"]);

  await sidebar(page).getByRole("link", { name: "Liked songs" }).click();
  await expect(rows(page)).toHaveText([/Glass Sky/, /Polar Drift/]);
  await expect(page.getByText("2 tracks")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Play Liked songs" }).click();
  await expect(bar(page).getByRole("link", { name: "Glass Sky" })).toBeVisible();
  // The queue kept on the device knows the like.
  await page.reload();
  await expect(bar(page).getByRole("button", { name: "Like Glass Sky" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Unliked, it leaves the list.
  await rows(page)
    .filter({ hasText: "Polar Drift" })
    .getByRole("button", { name: "Like Polar Drift" })
    .click();
  await expect(rows(page)).toHaveText([/Glass Sky/]);

  await sidebar(page).getByRole("link", { name: "Favourites" }).click();
  await expect(
    page.getByRole("list", { name: "Albums" }).getByRole("link", { name: "Northern Lights" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Artists" }).check();
  await expect(
    page.getByRole("list", { name: "Artists" }).getByRole("link", { name: "Aurora Fields" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("a playlist is made, filled, reordered, renamed and deleted", async ({ page, baseURL }) => {
  await sidebar(page).getByRole("button", { name: "New playlist" }).click();
  const create = page.getByRole("dialog", { name: "New playlist" });
  await expectAccessible(page);
  await create.getByRole("textbox", { name: "Name" }).fill("Road trip");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Road trip" })).toBeVisible();
  await expect(page.getByText("This playlist is empty")).toBeVisible();

  // A whole album from its menu, a track from its row's.
  await openAlbum(page, "Low Tide");
  await page.getByRole("button", { name: "More for Low Tide" }).click();
  await page.getByRole("menuitem", { name: "Add to playlist" }).click();
  const add = page.getByRole("dialog", { name: "Add to playlist" });
  await expect(add).toContainText("Adding Low Tide");
  await expectAccessible(page);
  await add.getByRole("button", { name: /^Road trip/ }).click();
  await expect(toast(page, "Road trip")).toHaveText("Low Tide is in Road trip");
  await openAlbum(page, "Polar Night");
  await page.getByRole("button", { name: "More for Ice Road" }).click();
  await page.getByRole("menuitem", { name: "Add to playlist" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Road trip/ })
    .click();
  await expect(toast(page, "Road trip")).toHaveText("Ice Road is in Road trip");

  await sidebar(page).getByRole("link", { name: "Road trip" }).click();
  await expect(rows(page)).toHaveText([/Harbor Lights/, /Salt/, /Undertow/, /Ice Road/]);
  await expect(page.getByText("4 tracks")).toBeVisible();

  // Dragged over the top half of the first row: it goes first.
  await rows(page)
    .filter({ hasText: "Ice Road" })
    .dragTo(rows(page).first(), { targetPosition: { x: 200, y: 4 } });
  await expect(rows(page)).toHaveText([/Ice Road/, /Harbor Lights/, /Salt/, /Undertow/]);
  await page.getByRole("button", { name: "More for Salt" }).click();
  await expectAccessible(page);
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect(rows(page)).toHaveText([/Ice Road/, /Salt/, /Harbor Lights/, /Undertow/]);
  await page.getByRole("button", { name: "More for Undertow" }).click();
  await page.getByRole("menuitem", { name: "Remove from this playlist" }).click();
  await expect(toast(page, "Road trip")).toHaveText("Undertow is no longer in Road trip");
  await expect(rows(page)).toHaveText([/Ice Road/, /Salt/, /Harbor Lights/]);

  // The server has the same order.
  const api = await login(baseURL!, account);
  const [listed] = (await api.GET("/api/v1/playlists")).data!;
  await expect
    .poll(async () => {
      const { data } = await api.GET("/api/v1/playlists/{playlist_id}", {
        params: { path: { playlist_id: listed!.id } },
      });
      return data?.items.map((item) => item.track.title);
    })
    .toEqual(["Ice Road", "Salt", "Harbor Lights"]);

  await page.getByRole("button", { name: "Play Road trip" }).click();
  await expect(bar(page).getByRole("link", { name: "Ice Road" })).toBeVisible();

  await page.getByRole("button", { name: "More for Road trip" }).click();
  await page.getByRole("menuitem", { name: "Edit details" }).click();
  const edit = page.getByRole("dialog", { name: "Edit details" });
  await edit.getByRole("textbox", { name: "Name" }).fill("Long road");
  await edit.getByRole("textbox", { name: /Description/ }).fill("North, then west.");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Long road" })).toBeVisible();
  await expect(page.getByText("North, then west.")).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Long road" })).toBeVisible();

  await page.getByRole("button", { name: "More for Long road" }).click();
  await page.getByRole("menuitem", { name: "Delete playlist" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Long road?" });
  await expectAccessible(page);
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL("/");
  await expect(sidebar(page).getByText("No playlists yet.")).toBeVisible();
});

test("what was listened to is in the history, until it is cleared", async ({ page, baseURL }) => {
  await page.goto("/history");
  await expect(page.getByText("Nothing played yet")).toBeVisible();
  await openAlbum(page, "Northern Lights");
  await page.getByRole("button", { name: "Play Northern Lights" }).click();
  // Half of the 20 seconds of Polar Drift.
  const api = await login(baseURL!, account);
  await expect
    .poll(async () => (await api.GET("/api/v1/me/history")).data?.items.length, {
      timeout: 20_000,
    })
    .toBe(1);
  await bar(page).getByRole("button", { name: "Pause" }).click();

  await sidebar(page).getByRole("link", { name: "History" }).click();
  await expect(page.getByRole("rowheader", { name: "Today" })).toBeVisible();
  await expect(rows(page)).toHaveText([/Polar Drift/]);
  await expectAccessible(page);

  await page.getByRole("button", { name: "Clear history" }).click();
  await page
    .getByRole("dialog", { name: "Clear the history?" })
    .getByRole("button", { name: "Clear" })
    .click();
  await expect(page.getByText("Nothing played yet")).toBeVisible();
  expect((await api.GET("/api/v1/me/history")).data?.items).toEqual([]);
  await page.getByRole("link", { name: "Home" }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recently played" })).toHaveCount(0);
});

test("phones: playlists from the library, the like in the full player", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library");
  await page.getByRole("button", { name: "New playlist" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Pocket");
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pocket" })).toBeVisible();
  await expectAccessible(page);

  await openAlbum(page, "Low Tide");
  await page.getByRole("button", { name: "More for Salt" }).click();
  await page.getByRole("menuitem", { name: "Add to Liked songs" }).click();
  await page.getByRole("button", { name: "Play Low Tide" }).click();
  await bar(page)
    .getByRole("button", { name: /Open the player/ })
    .click();
  const player = page.getByRole("dialog", { name: "Now playing" });
  const heart = player.getByRole("button", { name: "Like Harbor Lights" });
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");

  await page.goto("/library");
  await expect(page.getByRole("link", { name: "Pocket" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("link", { name: "Liked songs" }).click();
  await expect(rows(page)).toHaveText([/Harbor Lights/, /Salt/]);
  await expectAccessible(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
