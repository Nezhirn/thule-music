import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", ".e2e", "test-results", "playwright-report", "src/api/schema.d.ts"]),
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs["recommended-latest"], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.{ts,js}", "e2e/**", "scripts/**"],
    languageOptions: { globals: globals.node },
  },
]);
