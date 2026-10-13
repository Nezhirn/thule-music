import { expect, test, type Page } from "@playwright/test";
import { ambientColors, DEFAULT_ACCENT } from "../src/theme/theme";
import { createUser, login, signIn } from "./api";

/** "#15803d" as browsers report computed colours: "rgb(21, 128, 61)". */
function rgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" }).locator("..");
const saved = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/me/preferences") &&
      response.request().method() === "PATCH" &&
      response.ok(),
  );

test("appearance settings are kept on the server and follow the user", async ({
  page,
  browser,
  baseURL,
}) => {
  const account = await createUser(baseURL!);
  await signIn(page, account);
  await page.goto("/settings");
  await expect(sidebar(page)).not.toHaveCSS("backdrop-filter", "none");

  await Promise.all([saved(page), page.getByRole("radio", { name: "Green" }).check()]);
  const blur = page.getByRole("switch", { name: "Frosted glass" });
  await Promise.all([saved(page), blur.click()]);
  await expect(blur).toHaveAttribute("aria-checked", "false");
  // Buttons are painted with the accent, the panels lose the blur.
  const primary = page.getByRole("button", { name: "Change password" });
  await expect(primary).toHaveCSS("background-color", rgb("#15803d"));
  await expect(sidebar(page)).toHaveCSS("backdrop-filter", "none");

  // Another device, signed in afresh, looks the same.
  const device = await browser.newContext();
  const other = await device.newPage();
  await signIn(other, account);
  await expect(sidebar(other)).toHaveCSS("backdrop-filter", "none");
  await other.goto("/settings");
  await expect(other.getByRole("radio", { name: "Green" })).toBeChecked();
  await expect(other.getByRole("button", { name: "Change password" })).toHaveCSS(
    "background-color",
    rgb("#15803d"),
  );
  await device.close();
});

test("the cover colours can be tried on an album of the library", async ({ page, baseURL }) => {
  const account = await createUser(baseURL!);
  const api = await login(baseURL!, account);
  const { data } = await api.GET("/api/v1/albums", {
    params: { query: { limit: 24, sort: "added" } },
  });
  const album = data!.items.find((item) => item.cover_id)!;

  await signIn(page, account);
  await page.goto("/settings");
  const ambient = () =>
    page
      .getByTestId("backdrop")
      .evaluate((el) => getComputedStyle(el).getPropertyValue("--ambient-1"));
  await expect.poll(ambient).toBe(rgb(ambientColors(DEFAULT_ACCENT, null)[0]));

  const cover = page.getByRole("button", { name: `${album.title} — ${album.artist.name}` });
  await expect(cover.locator("img")).toHaveJSProperty("complete", true);
  expect(await cover.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(
    300,
  );
  await cover.click();
  // The backdrop fades over to the cover's colours.
  await expect.poll(ambient).toBe(rgb(ambientColors(DEFAULT_ACCENT, album.cover_palette)[0]));

  await page.getByRole("link", { name: "Home" }).first().click();
  await expect.poll(ambient).toBe(rgb(ambientColors(DEFAULT_ACCENT, null)[0]));
});
