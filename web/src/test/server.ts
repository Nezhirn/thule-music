import { setupServer } from "msw/node";

// Mock API for unit tests; each test adds the handlers it needs with `server.use(...)`.
// Requests nobody handles fail the test (see setup.ts).
export const server = setupServer();
