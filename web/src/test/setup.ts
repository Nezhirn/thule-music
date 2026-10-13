import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { getAccessToken } from "../auth/tokens";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(async () => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  // With the refresh token gone, this drops the access token the module keeps in memory, so
  // it doesn't leak into the next test.
  await getAccessToken();
});
afterAll(() => server.close());
