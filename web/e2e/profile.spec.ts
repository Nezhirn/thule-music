import { expect, test } from "@playwright/test";
import { createUser, signedIn, signIn } from "./api";

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

test("the display name and the photo can be changed", async ({ page, baseURL }) => {
  const account = await createUser(baseURL!);
  await signIn(page, account);
  await page.goto("/settings");

  await page.getByLabel(/Display name/).fill("Grace Hopper");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Account: Grace Hopper" })).toBeVisible();

  const card = page.getByRole("region", { name: "Account" });
  await expect(card.locator("img")).toHaveCount(0); // no photo by default
  await page
    .getByLabel("Photo")
    .setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await expect(card.getByRole("button", { name: "Change photo" })).toBeVisible();
  // Served by the server like a cover, at the size asked for.
  const photo = card.locator("img");
  await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(300);
  await expect(
    page.getByRole("button", { name: "Account: Grace Hopper" }).locator("img"),
  ).toBeVisible();

  await page.reload();
  await expect(card.getByRole("button", { name: "Change photo" })).toBeVisible();
  await card.getByRole("button", { name: "Remove photo" }).click();
  await expect(card.getByRole("button", { name: "Upload photo" })).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
});

test("a new password signs out the other devices, not this one", async ({
  page,
  browser,
  baseURL,
}) => {
  const account = await createUser(baseURL!);
  const device = await browser.newContext();
  const other = await device.newPage();
  await signIn(other, account);
  await signIn(page, account);

  await page.goto("/settings");
  const card = page.getByRole("region", { name: "Password" });
  await card.getByLabel("Current password").fill(account.password);
  await card.getByLabel("New password", { exact: true }).fill("a-new-password");
  await card.getByLabel("Repeat new password").fill("a-new-password");
  await card.getByRole("button", { name: "Change password" }).click();
  await expect(card.getByRole("status")).toHaveText(
    "Password changed. Your other devices were signed out.",
  );
  // This device keeps working, after a restart too: it stored the new tokens.
  await page.reload();
  await signedIn(page);

  // The other one is signed out when it next renews its session.
  await other.reload();
  await expect(other.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signIn(other, { ...account, password: "a-new-password" });
  await device.close();
});
