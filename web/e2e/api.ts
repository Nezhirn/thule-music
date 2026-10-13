// Typed API access for E2E tests: the same generated types and client library as the app,
// through the web origin's /api proxy.
import { expect, type Page } from "./test";
import createClient from "openapi-fetch";
import type { paths } from "../src/api/schema";

export interface Account {
  username: string;
  password: string;
}

/** Created through the first-run page by first-run.spec.ts. */
export const ADMIN: Account = { username: "admin", password: "e2e-admin-password" };

export function apiClient(baseURL: string, accessToken?: string) {
  return createClient<paths>({
    baseUrl: baseURL,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

export async function login(baseURL: string, account: Account = ADMIN) {
  const { data, error } = await apiClient(baseURL).POST("/api/v1/auth/login", { body: account });
  expect(error).toBeUndefined();
  return apiClient(baseURL, data!.access_token);
}

let created = 0;

/** A new user account of its own, so tests that change account state don't collide. */
export async function createUser(baseURL: string): Promise<Account> {
  const account = {
    username: `user-${process.pid}-${Date.now()}-${created++}`,
    password: "e2e-user-password",
  };
  const admin = await login(baseURL);
  const { response } = await admin.POST("/api/v1/auth/register", { body: account });
  expect(response.status).toBe(201);
  return account;
}

/** The account menu's button: there once the app has started signed in, in either language. */
export const accountButton = (page: Page) =>
  page.getByRole("button", { name: /^(Account|Аккаунт): / });

export const signedIn = (page: Page) => expect(accountButton(page)).toBeVisible();

/** Signs in through the sign-in page (English UI). */
export async function signIn(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await signedIn(page);
}

/** Signs out through the account menu (English UI). */
export async function signOut(page: Page) {
  await accountButton(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
}
