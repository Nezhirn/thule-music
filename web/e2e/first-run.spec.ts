import { expect, test } from "./test";
import { ADMIN } from "./api";

// A Russian browser: the first-run page follows the device language.
test.use({ locale: "ru-RU" });

test("on first run the administrator account is created in the app", async ({ page, baseURL }) => {
  const setup = page.waitForResponse("**/api/v1/auth/setup");
  await page.goto("/");
  // The app talks to the API through its own origin.
  expect(new URL((await setup).url()).origin).toBe(baseURL);

  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Добро пожаловать в Thule" })).toBeVisible();
  await page.getByLabel("Имя пользователя").fill(ADMIN.username);
  await page.getByLabel(/Ваше имя/).fill("Администратор");
  await page.getByLabel("Пароль", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Повторите пароль").fill(ADMIN.password);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /Администратор/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Аккаунт: Администратор" })).toBeVisible();

  // From now on the setup page is gone.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/$/);
});
