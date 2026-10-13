import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { ADA, apiError, PREFERENCES, tokenPair, url } from "../test/api";
import { renderApp } from "../test/render";
import { server } from "../test/server";

function firstRunServer() {
  const registered: unknown[] = [];
  server.use(
    http.get(url("/api/v1/auth/setup"), () =>
      HttpResponse.json({ needs_setup: registered.length === 0 }),
    ),
    http.post(url("/api/v1/auth/register"), async ({ request }) => {
      registered.push(await request.json());
      return HttpResponse.json(ADA, { status: 201 });
    }),
    http.post(url("/api/v1/auth/login"), () => HttpResponse.json(tokenPair(1))),
    http.get(url("/api/v1/auth/me"), () => HttpResponse.json(ADA)),
    http.get(url("/api/v1/me/preferences"), () => HttpResponse.json(PREFERENCES)),
  );
  return registered;
}

test("creates the administrator and signs in", async () => {
  const registered = firstRunServer();
  const { user } = renderApp("/setup");
  await user.type(await screen.findByLabelText("Username"), "ada");
  await user.type(screen.getByLabelText(/Your name/), "Ada Lovelace");
  await user.type(screen.getByLabelText("Password"), "secret-password");
  await user.type(screen.getByLabelText("Repeat password"), "secret-password");
  await user.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(registered).toEqual([
    { username: "ada", password: "secret-password", display_name: "Ada Lovelace" },
  ]);
});

test("the server's rules for new accounts are checked before sending", async () => {
  const registered = firstRunServer();
  const { user } = renderApp("/setup");
  await user.type(await screen.findByLabelText("Username"), "ada lovelace");
  await user.type(screen.getByLabelText("Password"), "short");
  await user.type(screen.getByLabelText("Repeat password"), "shorter");
  await user.click(screen.getByRole("button", { name: "Create account" }));

  expect(screen.getByLabelText("Username")).toHaveAccessibleDescription(
    "Only Latin letters, digits, dots, hyphens and underscores",
  );
  expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("At least 8 characters");
  expect(screen.getByLabelText("Repeat password")).toHaveAccessibleDescription(
    "Passwords don't match",
  );
  expect(screen.getByLabelText("Username")).toHaveFocus();
  expect(registered).toEqual([]);
});

test("if someone finished the setup first, it says so on the sign-in page", async () => {
  const registered = firstRunServer();
  server.use(
    http.post(url("/api/v1/auth/register"), () => {
      registered.push("someone else");
      return apiError("registration_closed", 403);
    }),
  );
  const { user } = renderApp("/setup");
  await user.type(await screen.findByLabelText("Username"), "ada");
  await user.type(screen.getByLabelText("Password"), "secret-password");
  await user.type(screen.getByLabelText("Repeat password"), "secret-password");
  await user.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("The server is already set up.");
});

test("a server that is already set up has no setup page", async () => {
  server.use(http.get(url("/api/v1/auth/setup"), () => HttpResponse.json({ needs_setup: false })));
  renderApp("/setup");
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("The server is already set up.");
});
