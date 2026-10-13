// Runs the backend for the E2E tests (started by Playwright as a webServer): resets the
// scratch schema, generates the music library, then starts the API and the worker against
// them. Playwright kills the whole process group when the run ends.
//
// Backend logs go to .e2e/logs/ so they don't drown the test report; if a process dies, the
// tail of its log is printed.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateLibrary } from "./library.mjs";

const stand = fileURLToPath(new URL("../../.e2e/", import.meta.url));
const backend = fileURLToPath(new URL("../../../backend/", import.meta.url));
const python = process.env.THULE_PYTHON ?? `${backend}.venv/bin/python`;
const schema = process.env.THULE_E2E_SCHEMA ?? "thule_e2e";
const port = process.env.THULE_E2E_API_PORT ?? "8100";

try {
  execFileSync(python, ["scripts/reset_schema.py", schema], { cwd: backend, stdio: "pipe" });
} catch (error) {
  console.error(
    `E2E: could not reset schema ${schema}:\n${/** @type {{ stderr: Buffer }} */ (error).stderr}`,
  );
  process.exit(1);
}
await generateLibrary(`${stand}library`);
// What the admin tests uploaded last time.
await rm(`${stand}library/uploads`, { recursive: true, force: true });
await rm(`${stand}data`, { recursive: true, force: true });
await mkdir(`${stand}logs`, { recursive: true });

const env = {
  ...process.env,
  THULE_DB_SCHEMA: schema,
  THULE_LIBRARY_PATH: `${stand}library`,
  THULE_DATA_PATH: `${stand}data`,
  THULE_SECRET_KEY: "e2e-only-secret-key-0123456789abcdef0123456789",
  THULE_LRCLIB_ENABLED: "false",
};

const processes = {
  api: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", port],
  worker: ["-m", "app.jobs.worker", "--concurrency", "2"],
};
const children = Object.entries(processes).map(([name, args]) => {
  const log = `${stand}logs/${name}.log`;
  const out = createWriteStream(log);
  const child = spawn(python, args, { cwd: backend, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on("exit", async (code, signal) => {
    const tail = (await readFile(log, "utf8").catch(() => "")).split("\n").slice(-30).join("\n");
    console.error(`E2E ${name} exited (${signal ?? code}). Last lines of ${log}:\n${tail}`);
    shutdown(1);
  });
  return child;
});

/** @param {number} code */
function shutdown(code) {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
