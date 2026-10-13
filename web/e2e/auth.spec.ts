import { expect, test } from "./test";
import { accountButton, apiClient, createUser, signedIn, signIn, signOut } from "./api";

const REFRESH_TOKEN_KEY = "thule.refreshToken";

test("sign in, stay signed in across reloads, sign out", async ({ page, baseURL }) => {
  const account = await createUser(baseURL!);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Wrong username or password.");

  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(accountButton(page)).toHaveAccessibleName(`Account: ${account.username}`);

  await page.reload();
  await signedIn(page);

  const token = await page.evaluate((key) => localStorage.getItem(key), REFRESH_TOKEN_KEY);
  // The page says it signed out at once; the server hears of it a moment later.
  const loggedOut = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/logout"),
  );
  await signOut(page);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("You signed out.");
  expect((await loggedOut).status()).toBe(204);
  // The server revoked the token, not just the browser forgetting it.
  const { error } = await apiClient(baseURL!).POST("/api/v1/auth/refresh", {
    body: { refresh_token: token! },
  });
  expect(error?.code).toBe("invalid_refresh_token");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

for (const locks of [true, false]) {
  test(`tabs opening at once keep the session ${locks ? "(Web Locks)" : "(plain HTTP: no Web Locks)"}`, async ({
    context,
    page,
    baseURL,
  }) => {
    // Browsers offer Web Locks only over HTTPS and on localhost; without them colliding
    // tabs rely on the server's grace period for a just-rotated token.
    if (!locks) {
      await context.addInitScript(() =>
        Object.defineProperty(Navigator.prototype, "locks", { get: () => undefined }),
      );
    }
    const account = await createUser(baseURL!);
    await signIn(page, account);
    const tabs = [page, await context.newPage(), await context.newPage(), await context.newPage()];
    // Every start refreshes the token; four tabs starting together collide.
    for (let round = 0; round < 3; round++) {
      await Promise.all(tabs.map((tab) => tab.goto("/")));
      await Promise.all(tabs.map(signedIn));
    }
    const fresh = await context.newPage();
    await fresh.goto("/");
    await signedIn(fresh);
  });
}

test("a rejected access token is renewed and the request repeated", async ({ page, baseURL }) => {
  const account = await createUser(baseURL!);
  await signIn(page, account);
  let rejected = 0;
  await page.route("**/api/v1/auth/me", async (route) => {
    if (rejected++ > 0) return route.continue();
    await route.fulfill({ status: 401, json: { code: "invalid_token", detail: "expired" } });
  });
  await page.reload();
  await signedIn(page);
  expect(rejected).toBe(2);
});

test("signing out in one tab signs out the others", async ({ context, page, baseURL }) => {
  const account = await createUser(baseURL!);
  await signIn(page, account);
  const other = await context.newPage();
  await other.goto("/");
  await signedIn(other);

  await signOut(page);
  await expect(other.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("the language is saved to the account and follows it to other devices", async ({
  page,
  browser,
  baseURL,
}) => {
  const account = await createUser(baseURL!);
  await signIn(page, account);
  await page.goto("/settings");
  await page.getByRole("radio", { name: "Русский" }).check();
  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();

  const device = await browser.newContext({ locale: "en-US" });
  const other = await device.newPage();
  await other.goto("/login");
  await expect(other.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await other.getByLabel("Username").fill(account.username);
  await other.getByLabel("Password").fill(account.password);
  await other.getByRole("button", { name: "Sign in" }).click();
  await expect(other.getByRole("button", { name: `Аккаунт: ${account.username}` })).toBeVisible();
  await device.close();
});
