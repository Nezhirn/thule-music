import { expect, test } from "./test";
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

test("albums of a genre and in the chosen order, kept in the address", async ({ page }) => {
  await page.goto("/albums");
  await page.getByRole("combobox", { name: "Sort by" }).selectOption("Year");
  await expect(page).toHaveURL(/sort=year/);
  const cards = page.getByRole("main").getByRole("article");
  await expect(cards.first()).toContainText("Paper Moons"); // 2026, the newest
  const filters = page.getByRole("group", { name: "Filters" });
  await filters.getByRole("button", { name: "Genre" }).click();
  await page.getByRole("option", { name: /^Indie/ }).click();
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

test("tracks filtered by artist, genre and album; back undoes the last", async ({ page }) => {
  await page.goto("/tracks?sort=title");
  const table = page.getByRole("table", { name: "Tracks" });
  await expect(table.getByRole("row")).toHaveCount(18);
  const filters = page.getByRole("group", { name: "Filters" });

  // An artist found by typing: their own tracks, those they are a guest on, the compilation's.
  await filters.getByRole("button", { name: "Artist" }).click();
  await page.getByRole("combobox", { name: "Find: artist" }).fill("mira");
  const choices = (facet: string) => page.getByRole("listbox", { name: facet }).getByRole("option");
  await expect(choices("Artist")).toHaveText(["Mira Vale4"]);
  await page.keyboard.press("Enter");
  await expect(
    filters.getByRole("button", { name: "Artist: Mira Vale", exact: true }),
  ).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(page.getByText("4 tracks", { exact: true })).toBeVisible();

  // The genres of what is left, those with the most first.
  await filters.getByRole("button", { name: "Genre" }).click();
  await expect(choices("Genre")).toHaveText(["All genres", "Pop3", "Electronic1"]);
  await page.getByRole("option", { name: /^Pop/ }).click();
  await expect(table.getByRole("row")).toHaveCount(4);

  await filters.getByRole("button", { name: "Album" }).click();
  await expect(choices("Album")).toHaveText([
    "All albums",
    "Paper MoonsMira Vale2",
    "Summer MixVarious Artists1",
  ]);
  await page.getByRole("option", { name: /^Summer Mix/ }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table.getByRole("row").nth(1)).toContainText("Heatwave");
  await expect(page).toHaveURL(/sort=title&artist=.+&genre=Pop&album=/);

  await page.goBack();
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(filters.getByRole("button", { name: "Album" })).toBeVisible();
  await filters.getByRole("button", { name: "Clear filters" }).click();
  await expect(table.getByRole("row")).toHaveCount(18);
  await expect(page).toHaveURL(/\/tracks\?sort=title$/);
});

test("liked songs filtered: what the filters leave plays", async ({ page }) => {
  await page.goto("/tracks?sort=title");
  const table = page.getByRole("table", { name: "Tracks" });
  for (const title of ["Paper Moon", "Polar Drift", "Heatwave"]) {
    await table.getByRole("button", { name: `Like ${title}` }).click();
  }
  await page.goto("/liked");
  const liked = page.getByRole("table", { name: "Liked songs" });
  await expect(liked.getByRole("row")).toHaveCount(4);

  const filters = page.getByRole("group", { name: "Filters" });
  await filters.getByRole("button", { name: "Genre" }).click();
  // Of the liked songs only.
  await expect(page.getByRole("listbox", { name: "Genre" }).getByRole("option")).toHaveText([
    "All genres",
    "Pop2",
    "Electronic1",
  ]);
  await page.getByRole("option", { name: /^Pop/ }).click();
  await expect(liked.getByRole("row")).toHaveCount(3);
  await expect(page.getByText("2 tracks", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Play Liked songs" }).click();
  const player = page.getByRole("region", { name: "Player" });
  await expect(player.getByText("Heatwave")).toBeVisible();
  // A wide window shows the queue beside the page.
  const next = page
    .getByRole("complementary", { name: "Now playing" })
    .getByRole("list", { name: "Up next" });
  await expect(next.getByRole("listitem")).toHaveText([/Paper Moon/]);
});
