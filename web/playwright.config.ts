import { defineConfig, devices } from "@playwright/test";

// The E2E stand: the real backend (API + worker) on a scratch schema with a generated music
// library (e2e/stack/), serving the built app as it does in production. Every run starts
// from an empty database, so the projects run in order: first-run tests see
// a server without accounts, the setup project creates the admin and imports the library,
// then the rest run against that, the administration tests last.
const PORT = 8100;

export default defineConfig({
  testDir: "e2e",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORT}`,
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
  webServer: {
    command: "node e2e/stack/start.mjs",
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    env: { THULE_E2E_SCHEMA: "thule_e2e", THULE_E2E_API_PORT: String(PORT) },
    timeout: 180_000,
  },
});
