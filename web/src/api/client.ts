import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

// Same origin: in development and in E2E tests Vite proxies /api to the backend, in
// production the backend serves the app itself. Stream and cover URLs stay relative too.
export const api = createClient<paths>({
  baseUrl: window.location.origin,
  // Looked up per request rather than captured once, so test mocks installed later apply.
  fetch: (request) => globalThis.fetch(request),
});
