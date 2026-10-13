import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The dev and preview servers proxy /api to the backend, so the browser talks to one origin,
// as it does in production where the backend serves the built app. The Host header is kept:
// the backend sees the address the browser used.
const apiUrl = process.env.THULE_API_URL ?? "http://127.0.0.1:8000";
const proxy = { "/api": { target: apiUrl, changeOrigin: false } };

const COMPRESSIBLE = /\.(html|js|css|svg|json|txt)$/;

/** Writes .br and .gz copies of the built text files beside them: the server sends those to
 * browsers that accept them, without compressing on every request. */
function precompress(): Plugin {
  const toBrotli = promisify(brotliCompress);
  const toGzip = promisify(gzip);
  return {
    name: "thule:precompress",
    apply: "build",
    async writeBundle(options, bundle) {
      const files = Object.keys(bundle).filter((name) => COMPRESSIBLE.test(name));
      await Promise.all(
        files.map(async (name) => {
          const path = join(options.dir!, name);
          const content = await readFile(path);
          if (content.length < 1024) return;
          const copies = {
            br: await toBrotli(content, {
              params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
            }),
            gz: await toGzip(content, { level: 9 }),
          };
          for (const [suffix, copy] of Object.entries(copies)) {
            if (copy.length < content.length) await writeFile(`${path}.${suffix}`, copy);
          }
        }),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), precompress()],
  build: {
    rollupOptions: {
      output: {
        // Libraries in a file of their own: they change less often than the app, and a
        // browser keeps its copy across the app's releases.
        manualChunks: (id) => (id.includes("/node_modules/") ? "vendor" : undefined),
      },
    },
  },
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Lets a test read the tokens in global.css (other CSS imports stay empty in tests).
    css: { include: [/global\.css/] },
  },
});
