import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The dev and preview servers proxy /api to the backend, so the browser talks to one origin,
// as it does in production where the backend serves the built app. The Host header is kept:
// the backend sees the address the browser used.
const apiUrl = process.env.THULE_API_URL ?? "http://127.0.0.1:8000";
const proxy = { "/api": { target: apiUrl, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
