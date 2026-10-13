// Administration against the real server: the library's numbers and a scan, uploading an
// album folder (with its cover and lyrics) and files that are copies or not music, the
// errors of background work, lyrics and covers corrected by hand, albums, tracks and artists
// managed (in the files), and the users. Runs after the other tests (see the config):
// the uploaded album would change what they count.
import { expect, test, type Page } from "./test";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expectAccessible } from "./a11y";
import { ADMIN, createUser, login, signIn } from "./api";
import { makeCover, writeAlbum } from "./stack/library.mjs";

const LIBRARY = fileURLToPath(new URL("../.e2e/library/", import.meta.url));
const card = (page: Page, name: string) => page.getByRole("region", { name });
const tabs = (page: Page) => page.getByRole("navigation", { name: "Administration sections" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, ADMIN);
});

test("the library's numbers, and a scan that finds nothing new", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
  await expect(page).toHaveTitle("Library · Administration — Thule");
  const stats = card(page, "In the library");
  await expect(stats.getByRole("definition")).toHaveText([
    "17",
    "6",
    "4",
    /^(\d+ hrs? )?\d+ mins?$/,
    /^[\d.]+ [kMG]B$/,
  ]);
  const scanning = card(page, "Scanning");
  // The stand's setup scanned it.
  await expect(scanning.getByText(/^Last scan /)).toBeVisible();
  await expect(scanning.getByText("17 added · 17 audio files in the folder")).toBeVisible();
  await expect(card(page, "Background work").getByText("No errors.")).toBeVisible();
  await expectAccessible(page);

  await scanning.getByRole("button", { name: "Scan the library" }).click();
  await expect(scanning.getByText("nothing changed · 17 audio files in the folder")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "The library is up to date" }),
  ).toHaveText("The library is up to date: nothing changed.");
});

test("an album folder uploaded with its cover and lyrics; a copy and a broken file", async ({
  page,
  baseURL,
}, testInfo) => {
  // A folder as people have them: the album, its cover, lyrics beside a track, a stray file.
  const source = testInfo.outputPath("Fresh Tape");
  const folder = `${source}/2026 - First Upload`;
  await writeAlbum(
    folder,
    {
      artist: "Fresh Tape",
      title: "First Upload",
      year: 2026,
      genre: "Lo-Fi",
      format: "mp3",
      cover: { in: "folder", color: "#c0306a" },
      tracks: [{ title: "Opening", lrc: "[00:01.00]Tape is rolling" }, "Закрытие"],
    },
    testInfo.outputPath("covers"),
  );
  await writeFile(`${folder}/notes.md`, "# liner notes");
  const broken = testInfo.outputPath("broken.mp3");
  await writeFile(broken, "not audio at all ".repeat(100));

  await page.goto("/admin/uploads");
  await expect(page).toHaveTitle("Upload · Administration — Thule");
  await expectAccessible(page);
  const folderChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose a folder" }).click();
  await (await folderChooser).setFiles(source);
  await expect(page.getByText("1 file skipped: not music, a cover or lyrics.")).toBeVisible();

  const list = card(page, "Uploaded files");
  await expect(list.getByText("4 of 4 done")).toBeVisible({ timeout: 30_000 });
  const album = list.getByRole("list", { name: "Fresh Tape/2026 - First Upload" });
  await expect(album.getByRole("listitem")).toHaveCount(4);
  await expect(album.getByRole("listitem").filter({ hasText: "cover.jpg" })).toContainText("Saved");
  await expect(album.getByRole("listitem").filter({ hasText: "01 Opening.lrc" })).toContainText(
    "Saved",
  );
  const added = album.getByRole("listitem").filter({ hasText: "02 Закрытие.mp3" });
  await expect(added).toContainText("Added · First Upload — Fresh Tape", { timeout: 30_000 });
  await expect(album.getByRole("listitem").filter({ hasText: "01 Opening.mp3" })).toContainText(
    "Added",
  );
  await expect(page.getByRole("status").filter({ hasText: "Uploaded" })).toHaveText(
    "Uploaded: 2 files added.",
  );
  await expectAccessible(page);

  // A copy of a file in the library, and a file that only looks like music.
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose files" }).click();
  await (
    await fileChooser
  ).setFiles([`${LIBRARY}Aurora Fields/2024 - Northern Lights/01 Polar Drift.flac`, broken]);
  // Files picked on their own, not in a folder.
  const loose = list.getByRole("list", { name: "Uploaded files" });
  const copy = loose.getByRole("listitem").filter({ hasText: "01 Polar Drift.flac" });
  await expect(copy).toContainText("Already in the library · Northern Lights — Aurora Fields");
  const bad = loose.getByRole("listitem").filter({ hasText: "broken.mp3" });
  await expect(bad).toContainText("Couldn't be added", { timeout: 30_000 });
  await expect(bad).toContainText("can't sync to MPEG frame");

  // The album is in the library, with its cover and the lyrics from beside its track.
  await added.getByRole("link", { name: "First Upload" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "First Upload" })).toBeVisible();
  const cover = page.locator("header img");
  await expect(cover).toHaveJSProperty("complete", true);
  expect(await cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const api = await login(baseURL!);
  const { data: found } = await api.GET("/api/v1/search", { params: { query: { q: "Opening" } } });
  const opening = found?.tracks.find((track) => track.title === "Opening");
  expect(opening).toBeDefined();
  await expect
    .poll(async () => {
      const { data } = await api.GET("/api/v1/tracks/{track_id}/lyrics", {
        params: { path: { track_id: opening!.id } },
      });
      return data?.source;
    })
    .toBe("sidecar");

  // The broken file is among the errors of background work, until cleared.
  await page.goto("/admin");
  const jobs = card(page, "Background work");
  await expect(jobs.getByRole("heading", { name: "Errors · 1" })).toBeVisible();
  await expect(jobs.getByText("uploads/broken.mp3")).toBeVisible();
  await expect(card(page, "In the library").getByRole("definition").first()).toHaveText("19");
  await expectAccessible(page);
  await jobs.getByRole("button", { name: "Clear" }).click();
  await expect(jobs.getByText("No errors.")).toBeVisible();
});

test("users: a new one, a role, a password, signed out everywhere, deleted", async ({
  page,
  baseURL,
}) => {
  const listener = await createUser(baseURL!);
  await login(baseURL!, listener); // signed in somewhere
  await page.goto("/admin/users");
  await expect(page).toHaveTitle("Users · Administration — Thule");
  const users = card(page, "Users");
  const row = (name: string) => users.getByRole("listitem").filter({ hasText: name });
  await expect(row(ADMIN.username)).toContainText("you");
  await expect(row(listener.username)).toContainText("Signed in on 1 device");
  await expectAccessible(page);

  await users.getByRole("button", { name: "New user" }).click();
  const dialog = page.getByRole("dialog", { name: "New user" });
  const username = `new-${Date.now()}`;
  await dialog.getByLabel("Username").fill(username);
  await dialog.getByLabel(/^Name/).fill("Новенький");
  await dialog.getByLabel("Password").fill("new-user-password");
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(row("Новенький")).toContainText(`${username} · User`);
  await expect(row("Новенький")).toContainText("Hasn't signed in yet");
  // They can sign in with it.
  await login(baseURL!, { username, password: "new-user-password" });

  const actions = () => users.getByRole("button", { name: `Actions for ${listener.username}` });
  await actions().click();
  await expectAccessible(page);
  await page.getByRole("menuitem", { name: "Make administrator" }).click();
  await expect(row(listener.username)).toContainText("Administrator");

  await actions().click();
  await page.getByRole("menuitem", { name: "Set a new password" }).click();
  const password = page.getByRole("dialog", { name: `New password for ${listener.username}` });
  await password.getByLabel("New password").fill("changed-by-admin");
  await password.getByRole("button", { name: "Set password" }).click();
  await expect(password).toBeHidden();
  // The new password works; and that signed them in again.
  await login(baseURL!, { username: listener.username, password: "changed-by-admin" });
  await page.reload();
  await expect(row(listener.username)).toContainText("Signed in on 1 device");

  await actions().click();
  await page.getByRole("menuitem", { name: "Sign out everywhere" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  await expect(row(listener.username)).not.toContainText("Signed in on");

  await actions().click();
  await page.getByRole("menuitem", { name: "Delete user" }).click();
  await expectAccessible(page);
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(row(listener.username)).toHaveCount(0);
});

test("lyrics and covers corrected by hand, and given up again", async ({ page }, testInfo) => {
  const blue = testInfo.outputPath("blue.jpg");
  const red = testInfo.outputPath("red.jpg");
  await makeCover(blue, "#2040c0");
  await makeCover(red, "#c02030");
  const status = (text: string) => page.getByRole("status").filter({ hasText: text });
  const bar = page.getByRole("region", { name: "Player" });

  // An album without art gets a cover.
  await page.goto("/albums?sort=title");
  await page.getByRole("link", { name: "Paper Moons", exact: true }).click();
  const art = page.locator("main header img");
  await expect(art).toHaveCount(0);
  await page.getByRole("button", { name: "More for Paper Moons" }).click();
  await page.getByRole("menuitem", { name: "Change cover" }).click();
  let dialog = page.getByRole("dialog", { name: "Album cover" });
  await expect(dialog).toHaveAccessibleDescription("Paper Moons — Mira Vale");
  await expectAccessible(page);
  await dialog.getByLabel("Choose an image").setInputFiles(blue);
  await expect(status("Changed the cover")).toHaveText("Changed the cover of Paper Moons");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(art).toHaveAttribute("src", /^\/api\/v1\/covers\/[\w-]+\?size=300$/);
  const albumCover = await art.getAttribute("src");

  // A track gets a picture of its own: the player shows it, the album keeps its cover.
  await page.getByRole("button", { name: "More for Neon Rain" }).click();
  await page.getByRole("menuitem", { name: "Change cover" }).click();
  dialog = page.getByRole("dialog", { name: "Track cover" });
  await dialog.getByLabel("Choose an image").setInputFiles(red);
  await expect(status("Changed the cover")).toHaveText("Changed the cover of Neon Rain");
  await expect(dialog.getByRole("button", { name: "Show the album cover" })).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Play Neon Rain" }).click();
  await expect(bar.locator("img").first()).toHaveAttribute("src", /\/api\/v1\/covers\//);
  expect(await bar.locator("img").first().getAttribute("src")).not.toBe(albumCover);
  await expect(art).toHaveAttribute("src", albumCover!);

  // Both given up: the album has no art in its files.
  await page.getByRole("button", { name: "More for Neon Rain" }).click();
  await page.getByRole("menuitem", { name: "Change cover" }).click();
  await dialog.getByRole("button", { name: "Show the album cover" }).click();
  await expect(dialog.getByRole("button", { name: "Show the album cover" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "More for Paper Moons" }).click();
  await page.getByRole("menuitem", { name: "Change cover" }).click();
  dialog = page.getByRole("dialog", { name: "Album cover" });
  await dialog.getByRole("button", { name: "Take it from the files" }).click();
  await expect(dialog.getByRole("button", { name: "Take it from the files" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(art).toHaveCount(0);

  // Lyrics written by hand, then found again in the file beside the track.
  await page.goto("/albums?sort=title");
  await page.getByRole("link", { name: "Northern Lights", exact: true }).click();
  await page.getByRole("button", { name: "Play Northern Lights" }).click();
  await bar.getByRole("button", { name: "Lyrics" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Polar Drift" })).toBeVisible();
  const words = page.getByRole("region", { name: "Lyrics" });
  await words.getByRole("button", { name: "Edit lyrics" }).click();
  dialog = page.getByRole("dialog", { name: "Lyrics" });
  const field = dialog.getByRole("textbox", { name: "Words" });
  await expect(field).toHaveValue(
    "Snow on the rails\nLights in the north\n\nWe drift until morning",
  );
  await expectAccessible(page);
  await field.fill("Rails under snow\n\nMorning at last");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(status("Saved the lyrics")).toHaveText("Saved the lyrics of Polar Drift");
  await expect(words.getByRole("paragraph")).toHaveText([
    "Rails under snow",
    "Morning at last",
    "Added by an administrator",
  ]);

  await words.getByRole("button", { name: "Edit lyrics" }).click();
  await dialog.getByRole("button", { name: "Find automatically" }).click();
  await expect(status("Found the lyrics")).toHaveText("Found the lyrics of Polar Drift");
  await expect(words.getByRole("paragraph")).toHaveText([
    "Snow on the railsLights in the north",
    "We drift until morning",
    "From a file next to the track",
  ]);
});

/** Scans the library and waits for it: what it found. */
async function scanned(baseURL: string) {
  const api = await login(baseURL);
  const { data: started } = await api.POST("/api/v1/library/scan");
  let found: { added: number; updated: number; moved: number; removed: number } | null = null;
  await expect
    .poll(
      async () => {
        const { data } = await api.GET("/api/v1/library/scan");
        found = data?.id === started!.id && data.status === "done" ? data.result : null;
        return found !== null;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

test("albums, tracks and artists managed in the files: a scan then finds nothing to do", async ({
  page,
  baseURL,
}, testInfo) => {
  // Files the scan adds every time: the broken upload, which never becomes a track.
  const before = await scanned(baseURL!);
  const status = (text: string) => page.getByRole("status").filter({ hasText: text });
  const open = async (title: string) => {
    await page.goto("/albums?sort=title");
    await page.getByRole("link", { name: title, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  };
  const menu = async (name: string, item: string) => {
    await page.getByRole("button", { name: `More for ${name}`, exact: true }).click();
    await page.getByRole("menuitem", { name: item }).click();
  };
  const rows = page.getByRole("table").getByRole("row");

  // An album renamed and dated.
  await open("Low Tide");
  await menu("Low Tide", "Edit album");
  let dialog = page.getByRole("dialog", { name: "Edit album" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Low Tide (Remastered)");
  await dialog.getByRole("textbox", { name: /Year/ }).fill("2024");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(status("Saved")).toHaveText("Saved Low Tide (Remastered)");
  await expect(
    page.getByRole("heading", { level: 1, name: "Low Tide (Remastered)" }),
  ).toBeVisible();
  await expect(page.getByText("2024", { exact: true })).toBeVisible();

  // A track retitled, with a guest.
  await menu("Salt", "Edit track");
  dialog = page.getByRole("dialog", { name: "Edit track" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Salt Water");
  await dialog.getByRole("button", { name: "Add an artist" }).click();
  await dialog.getByRole("textbox", { name: "Featured artist 1" }).fill("Mira Vale");
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(status("Saved")).toHaveText("Saved Salt Water");
  const salt = rows.filter({ hasText: "Salt Water" });
  await expect(salt.getByRole("link", { name: "Mira Vale" })).toBeVisible();

  // A track moved to another artist's album, found by its title.
  await menu("Undertow", "Move to another album");
  dialog = page.getByRole("dialog", { name: "Move tracks" });
  await dialog.getByRole("searchbox", { name: "Find an album" }).fill("Polar");
  await dialog.getByRole("radio", { name: /Polar Night/ }).check();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Move" }).click();
  await expect(status("Moved")).toHaveText("Moved 1 track to Polar Night");
  await expect(rows.filter({ hasText: "Undertow" })).toHaveCount(0);

  // The artist renamed.
  await page.getByRole("link", { name: "The Glass Harbor" }).first().click();
  await menu("The Glass Harbor", "Rename artist");
  dialog = page.getByRole("dialog", { name: "Rename artist" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Glass Harbor");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(status("Renamed")).toHaveText("Renamed to Glass Harbor");
  await expect(page.getByRole("heading", { level: 1, name: "Glass Harbor" })).toBeVisible();

  // A file uploaded into an album, then deleted.
  const loose = testInfo.outputPath("Loose");
  await writeAlbum(
    loose,
    {
      artist: "Nobody",
      title: "Loose",
      year: 2026,
      genre: "Pop",
      format: "mp3",
      cover: null,
      tracks: ["Lost Song"],
    },
    testInfo.outputPath("covers"),
  );
  await open("Paper Moons");
  await menu("Paper Moons", "Upload tracks");
  dialog = page.getByRole("dialog", { name: "Upload into the album" });
  await dialog.getByLabel("Choose files").setInputFiles(`${loose}/01 Lost Song.mp3`);
  await expect(dialog.getByRole("listitem")).toHaveText(/Lost Song\s*Added/);
  await expect(status("Added")).toHaveText("Added 1 track");
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(rows.filter({ hasText: "Lost Song" })).toBeVisible();
  await menu("Lost Song", "Delete track");
  dialog = page.getByRole("dialog", { name: "Delete track" });
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(status("Deleted")).toHaveText("Deleted Lost Song");
  await expect(rows.filter({ hasText: "Lost Song" })).toHaveCount(0);

  // An album turned into singles: its artist's page shows them.
  await menu("Paper Moons", "Delete album");
  dialog = page.getByRole("dialog", { name: "Delete album" });
  await dialog.getByRole("radio", { name: /Keep the tracks as singles/ }).check();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(status("singles")).toHaveText("The tracks of Paper Moons are singles now");
  await expect(page.getByRole("heading", { level: 1, name: "Mira Vale" })).toBeVisible();
  for (const single of ["Paper Moon", "Neon Rain"]) {
    await expect(page.getByRole("link", { name: single, exact: true }).first()).toBeVisible();
  }

  // An album deleted with its files, the moved track too.
  await open("Polar Night");
  await expect(rows.filter({ hasText: "Undertow" })).toBeVisible();
  await menu("Polar Night", "Delete album");
  dialog = page.getByRole("dialog", { name: "Delete album" });
  await dialog.getByRole("radio", { name: /Delete it with its tracks/ }).check();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(status("Deleted")).toHaveText("Deleted Polar Night");
  await expect(page.getByRole("heading", { level: 1, name: "Albums" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Polar Night", exact: true })).toHaveCount(0);

  // The files say what the library shows: nothing new for a scan to read.
  expect(await scanned(baseURL!)).toMatchObject({
    added: before.added,
    updated: 0,
    moved: 0,
    removed: 0,
  });
});

test("on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [tab, heading] of [
    ["Library", "Scanning"],
    ["Upload", "Upload music"],
    ["Users", "Users"],
  ] as const) {
    await page.goto("/admin");
    await tabs(page).getByRole("link", { name: tab }).click();
    await expect(card(page, heading)).toBeVisible();
    await expectAccessible(page);
  }
});
