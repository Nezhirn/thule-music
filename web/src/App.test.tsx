import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "./api/client";
import { App } from "./App";
import { server } from "./test/server";

test("offers the first-run setup while the server has no accounts", async () => {
  server.use(
    http.get("*/api/v1/auth/setup", () =>
      HttpResponse.json<Schemas["SetupStatus"]>({ needs_setup: true }),
    ),
  );
  render(<App />);
  expect(await screen.findByText(/first run/i)).toBeInTheDocument();
});

test("reports an unreachable server", async () => {
  server.use(http.get("*/api/v1/auth/setup", () => HttpResponse.error()));
  render(<App />);
  expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
});
