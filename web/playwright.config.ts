import { defineConfig, devices } from "@playwright/test";

// The E2E stand: the real backend (API + worker) on a scratch schema with a generated music
// library (e2e/stack/), serving the built app as it does in production. Every run starts
// from an empty database, so the projects run in order: first-run tests see
// a server without accounts, the setup project creates the admin and imports the library,
// then the rest run against that, the administration tests last.
// Another schema and port let a second checkout run its tests against the same database.
const PORT = Number(process.env.THULE_E2E_PORT ?? 8100);
const SCHEMA = process.env.THULE_E2E_SCHEMA ?? "thule_e2e";

export default defineConfig({
  testDir: "e2e",
  // A test may wait on the worker (a scan, an import, transcodes): the default 30 s cut the
  // setup's own 60 s wait short.
  timeout: 90_000,
  // No retries: the tests share one database and build on what the earlier ones did, so a
  // second try would start from what the failed one left. A failure is looked at instead.
  retries: 0,
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
    env: { THULE_E2E_SCHEMA: SCHEMA, THULE_E2E_API_PORT: String(PORT) },
    timeout: 180_000,
  },
});
