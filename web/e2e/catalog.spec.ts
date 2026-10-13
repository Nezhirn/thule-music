import { expect, test } from "@playwright/test";
import { createUser, signIn } from "./api";

test.beforeEach(async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, await createUser(baseURL!));
});

test("from the home page to an album, its guest and the albums they appear on", async ({
  page,
}) => {
  const added = page.getByRole("region", { name: "Recently added" });
  await expect(added.getByRole("article")).toHaveCount(6);
  await added.getByRole("link", { name: "Northern Lights" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Northern Lights" })).toBeVisible();
  await expect(page).toHaveTitle("Northern Lights — Thule");
  const tracks = page.getByRole("table", { name: "Northern Lights" });
  await expect(tracks.getByRole("row")).toHaveCount(5); // the header and four tracks
  // "Aurora Fields feat. Mira Vale" credits both, and Mira Vale is an artist of her own.
  const shared = tracks.getByRole("row").filter({ hasText: "Shared Sky" });
  await expect(shared.getByRole("link")).toHaveText(["Aurora Fields", "Mira Vale"]);
  await shared.getByRole("link", { name: "Mira Vale" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Mira Vale" })).toBeVisible();
  const own = page.getByRole("region", { name: "Albums" });
  await expect(own.getByRole("link", { name: "Paper Moons" })).toBeVisible();
  const appears = page.getByRole("region", { name: "Appears on" });
  await expect(appears.getByRole("article")).toHaveCount(2);
  await expect(appears.getByRole("link", { name: "Summer Mix" })).toBeVisible();
  await expect(appears.getByRole("link", { name: "Northern Lights" })).toBeVisible();
});

test("an album on two discs, with the art from above its disc folders", async ({ page }) => {
  await page.goto("/albums?sort=title");
  await page.getByRole("link", { name: "Deep Water" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deep Water" })).toBeVisible();
  const tracks = page.getByRole("table", { name: "Deep Water" });
  await expect(tracks.getByRole("rowheader")).toHaveText(["Disc 1", "Disc 2"]);
  await expect(page.getByText("4 tracks, 2 min")).toBeVisible();
  const cover = page.locator("header img");
  await expect(cover).toHaveJSProperty("complete", true);
  expect(await cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});

test("a compilation credits each track's artist", async ({ page }) => {
  await page.goto("/albums?genre=Pop");
  await expect(page.getByRole("heading", { level: 1, name: "Pop" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByRole("link", { name: "Summer Mix" }).click();
  await expect(page.getByText("Compilation", { exact: true })).toBeVisible();
  const tracks = page.getByRole("table", { name: "Summer Mix" });
  await expect(tracks.getByRole("link")).toHaveText(["Mira Vale", "The Glass Harbor"]);
});

test("albums by genre and in the chosen order, kept in the address", async ({ page }) => {
  await page.goto("/albums");
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("Year");
  await expect(page).toHaveURL(/sort=year/);
  const cards = page.getByRole("main").getByRole("article");
  await expect(cards.first()).toContainText("Paper Moons"); // 2026, the newest
  await page
    .getByRole("navigation", { name: "Genre" })
    .getByRole("link", { name: "Indie" })
    .click();
  await expect(page).toHaveURL(/genre=Indie/);
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Low Tide"); // 2023
  await expect(cards.nth(1)).toContainText("Deep Water"); // 2021

  // Back to the list from an album: the same filter and order.
  await cards.nth(0).getByRole("link", { name: "Low Tide" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Low Tide" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Indie" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue("year");
});

test("all tracks, by artist", async ({ page }) => {
  await page.goto("/tracks?sort=artist");
  const table = page.getByRole("table", { name: "Tracks" });
  await expect(table.getByRole("row")).toHaveCount(18); // the header and 17 tracks
  await expect(table.getByRole("row").nth(1)).toContainText("Polar Drift");
  await expect(
    table.getByRole("row").nth(1).getByRole("link", { name: "Northern Lights" }),
  ).toBeVisible();
});
