import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Mock API for unit tests; each test adds the handlers it needs with `server.use(...)`.
// Requests nobody handles fail the test (see setup.ts). These defaults (an empty library)
// stay after each test's handlers are reset.
const empty = () => HttpResponse.json({ items: [], total: 0, limit: 60, offset: 0 });

export const server = setupServer(
  http.get("*/api/v1/playlists", () => HttpResponse.json([])),
  http.get("*/api/v1/albums", empty),
  http.get("*/api/v1/artists", empty),
  http.get("*/api/v1/tracks", empty),
  http.get("*/api/v1/genres", () => HttpResponse.json([])),
  http.get("*/api/v1/home", () =>
    HttpResponse.json({ recently_added: [], new_releases: [], recently_played: [], for_you: [] }),
  ),
);
