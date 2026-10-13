import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Mock API for unit tests; each test adds the handlers it needs with `server.use(...)`.
// Requests nobody handles fail the test (see setup.ts). These defaults (an empty library)
// stay after each test's handlers are reset.
export const server = setupServer(
  http.get("*/api/v1/playlists", () => HttpResponse.json([])),
  http.get("*/api/v1/albums", () =>
    HttpResponse.json({ items: [], total: 0, limit: 24, offset: 0 }),
  ),
);
