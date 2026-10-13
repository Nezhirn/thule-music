// Typed API access for E2E tests: the same generated types and client library as the app,
// through the web origin's /api proxy.
import { expect } from "@playwright/test";
import createClient from "openapi-fetch";
import type { paths } from "../src/api/schema";

export const ADMIN = { username: "admin", password: "e2e-admin-password" };

export function apiClient(baseURL: string, accessToken?: string) {
  return createClient<paths>({
    baseUrl: baseURL,
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}

export async function login(baseURL: string, user = ADMIN) {
  const { data, error } = await apiClient(baseURL).POST("/api/v1/auth/login", { body: user });
  expect(error).toBeUndefined();
  return apiClient(baseURL, data!.access_token);
}
