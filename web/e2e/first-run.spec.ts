import { expect, test } from "@playwright/test";

test("the app talks to the API through its own origin", async ({ page, baseURL }) => {
  const setup = page.waitForResponse("**/api/v1/auth/setup");
  await page.goto("/");
  const response = await setup;
  expect(new URL(response.url()).origin).toBe(baseURL);
  expect(await response.json()).toEqual({ needs_setup: true });
  await expect(page.getByRole("status")).toHaveText(/first run/i);
});
