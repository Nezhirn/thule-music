import { defineConfig, devices } from "@playwright/test";

// The E2E stand: the real backend (API + worker) on a scratch schema with a generated music
// library (e2e/stack/), and the built app served by `vite preview`, which proxies /api to it.
// Every run starts from an empty database, so the projects run in order: first-run tests see
// a server without accounts, the setup project creates the admin and imports the library,
// then the rest run against that, the administration tests last.
const API_PORT = 8100;
const WEB_PORT = 4174;

export default defineConfig({
  testDir: "e2e",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Without a UTF-8 locale Chromium can't read picked files with non-Latin names.
    launchOptions: { env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } },
  },
  projects: [
    { name: "first-run", testMatch: "first-run.spec.ts" },
    { name: "setup", testMatch: "*.setup.ts", dependencies: ["first-run"] },
    {
      name: "app",
      testMatch: "*.spec.ts",
      testIgnore: ["first-run.spec.ts", "admin.spec.ts"],
      dependencies: ["setup"],
    },
    // Last: uploading adds an album, which the counts of the catalogue tests don't expect.
    { name: "admin", testMatch: "admin.spec.ts", dependencies: ["app"] },
  ],
  webServer: [
    {
      command: "node e2e/stack/start.mjs",
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      env: { THULE_E2E_SCHEMA: "thule_e2e", THULE_E2E_API_PORT: String(API_PORT) },
      timeout: 120_000,
    },
    {
      command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { THULE_API_URL: `http://127.0.0.1:${API_PORT}` },
      timeout: 120_000,
    },
  ],
});
