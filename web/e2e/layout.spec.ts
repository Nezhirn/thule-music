import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { accountButton, createUser, signIn } from "./api";

test("the layout follows the width of the screen", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, await createUser(baseURL!));
  const sidebar = page.getByRole("navigation", { name: "Main" });
  const tabs = page.getByRole("navigation", { name: "Sections" });
  const nowPlaying = page.getByRole("complementary", { name: "Now playing" });
  const player = page.getByRole("region", { name: "Player" });

  // Desktop: navigation, page, what plays, the player.
  await expect(sidebar).toBeVisible();
  await expect(nowPlaying).toBeVisible();
  await expect(player).toBeVisible();
  await expect(tabs).toBeHidden();

  // Laptop: no room for the right column.
  await page.setViewportSize({ width: 1100, height: 760 });
  await expect(nowPlaying).toBeHidden();
  await expect(sidebar).toBeVisible();

  // Phone: sections as tabs at the bottom, the library as a page.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeHidden();
  await expect(player).toBeHidden();
  await expect(tabs).toBeVisible();
  await tabs.getByRole("link", { name: "Library" }).click();
  await page.getByRole("main").getByRole("link", { name: "Albums" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Albums" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(
    violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

for (const [device, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  test(`pages pass automated accessibility checks (${device})`, async ({ page, baseURL }) => {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expectAccessible(page);

    await signIn(page, await createUser(baseURL!));
    await expectAccessible(page);
    await accountButton(page).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectAccessible(page);
    await page.keyboard.press("Escape");

    for (const path of ["/settings", "/library", "/albums"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectAccessible(page);
    }
  });
}
