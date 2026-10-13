// Generates src/api/schema.d.ts from the backend's OpenAPI schema.
// `--check` regenerates in memory and fails if the committed file differs: the API changed
// and the client's types haven't caught up.
//
// Needs the backend's Python environment: THULE_PYTHON, or backend/.venv by default.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const backendDir = fileURLToPath(new URL("../../backend/", import.meta.url));
const output = fileURLToPath(new URL("../src/api/schema.d.ts", import.meta.url));
const python = process.env.THULE_PYTHON ?? `${backendDir}.venv/bin/python`;

const schema = JSON.parse(
  execFileSync(python, ["scripts/openapi.py"], {
    cwd: backendDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const header =
  "// Generated from the backend's OpenAPI schema by `npm run api:types`. Do not edit.\n\n";
// The backend lists response fields that have defaults as required, so a default alone
// must not make a field required (it would make request fields like `role` mandatory).
const types = header + astToString(await openapiTS(schema, { defaultNonNullable: false }));

if (process.argv.includes("--check")) {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== types) {
    console.error("src/api/schema.d.ts is out of date with the backend: run `npm run api:types`");
    process.exit(1);
  }
  console.log("API types are up to date");
} else {
  await writeFile(output, types);
  console.log("Wrote src/api/schema.d.ts");
}
