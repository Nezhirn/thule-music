import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { ADA, apiError, PREFERENCES, tokenPair, url } from "../test/api";
import { renderApp } from "../test/render";
import { server } from "../test/server";
import { REFRESH_TOKEN_KEY } from "./tokens";

/** A configured server where `ada` signs in with "secret-password". */
function serverWithAccount(preferences: Partial<Schemas["Preferences"]> = {}) {
  const calls: { path: string; body: unknown }[] = [];
  const record = async (request: Request) =>
    calls.push({ path: new URL(request.url).pathname, body: await request.clone().json() });
  server.use(
    http.get(url("/api/v1/auth/setup"), () => HttpResponse.json({ needs_setup: false })),
    http.post(url("/api/v1/auth/login"), async ({ request }) => {
      await record(request);
      const { password } = (await request.json()) as Schemas["Credentials"];
      return password === "secret-password"
        ? HttpResponse.json(tokenPair(1))
        : apiError("invalid_credentials", 401);
    }),
    http.post(url("/api/v1/auth/refresh"), () => HttpResponse.json(tokenPair(2))),
    http.post(url("/api/v1/auth/logout"), async ({ request }) => {
      await record(request);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(url("/api/v1/auth/me"), () => HttpResponse.json(ADA)),
    http.get(url("/api/v1/me/preferences"), () =>
      HttpResponse.json({ ...PREFERENCES, ...preferences }),
    ),
    http.patch(url("/api/v1/me/preferences"), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ ...PREFERENCES, ...((await request.json()) as object) });
    }),
  );
  return calls;
}

test("signing in opens the app; signing out returns to the sign-in page", async () => {
  const calls = serverWithAccount();
  const { user } = renderApp("/");
  await user.type(await screen.findByLabelText("Username"), " ada ");
  await user.type(screen.getByLabelText("Password"), "secret-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-1");
  expect(calls[0]).toEqual({
    path: "/api/v1/auth/login",
    body: { username: "ada", password: "secret-password" },
  });

  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("You signed out.");
  expect(calls.at(-1)).toEqual({
    path: "/api/v1/auth/logout",
    body: { refresh_token: "refresh-1" },
  });
  expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
});

test("empty fields are pointed out without asking the server", async () => {
  const calls = serverWithAccount();
  const { user } = renderApp("/login");
  await user.click(await screen.findByRole("button", { name: "Sign in" }));
  expect(screen.getAllByText("Fill in this field")).toHaveLength(2);
  expect(screen.getByLabelText("Username")).toHaveFocus();
  expect(calls).toEqual([]);
});

test("a wrong password is reported in the user's language", async () => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["ru-RU", "ru"]);
  serverWithAccount();
  const { user } = renderApp("/login");
  await user.type(await screen.findByLabelText("Имя пользователя"), "ada");
  await user.type(screen.getByLabelText("Пароль"), "wrong-password");
  await user.click(screen.getByRole("button", { name: "Войти" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Неверное имя пользователя или пароль.",
  );
  expect(screen.getByLabelText("Пароль")).toHaveValue("");
});

test("after too many failures the page says when to try again", async () => {
  serverWithAccount();
  server.use(
    http.post(url("/api/v1/auth/login"), () =>
      apiError("too_many_login_attempts", 429, { "Retry-After": "125" }),
    ),
  );
  const { user } = renderApp("/login");
  await user.type(await screen.findByLabelText("Username"), "ada");
  await user.type(screen.getByLabelText("Password"), "whatever");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 3 minutes.");
});

test("a stored session is restored on start", async () => {
  serverWithAccount();
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-2");
});

test("a session the server ended is explained on the sign-in page", async () => {
  serverWithAccount();
  server.use(http.post(url("/api/v1/auth/refresh"), () => apiError("refresh_token_reused", 401)));
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("signed out on all devices");
});

test("a stored session the server can't confirm offers to try again", async () => {
  serverWithAccount();
  server.use(http.post(url("/api/v1/auth/refresh"), () => HttpResponse.error()));
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
  const { user } = renderApp("/");
  expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");

  server.use(http.post(url("/api/v1/auth/refresh"), () => HttpResponse.json(tokenPair(2))));
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
});

test("the language chosen before signing in stays on the device", async () => {
  serverWithAccount();
  const { user } = renderApp("/login");
  await user.click(await screen.findByRole("button", { name: "Русский" }));
  expect(screen.getByRole("heading", { name: "Вход" })).toBeInTheDocument();
  expect(document.documentElement.lang).toBe("ru");
  expect(localStorage.getItem("thule.language")).toBe("ru");
});

test("the account's language applies once signed in", async () => {
  serverWithAccount({ language: "ru" });
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
  renderApp("/");
  expect(await screen.findByText("Вы вошли как")).toBeInTheDocument();
});

test("a language chosen while signed in is saved to the account", async () => {
  const calls = serverWithAccount();
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
  const { user } = renderApp("/");
  await user.click(await screen.findByRole("button", { name: "Русский" }));
  expect(screen.getByText("Вы вошли как")).toBeInTheDocument();
  expect(calls).toContainEqual({ path: "/api/v1/me/preferences", body: { language: "ru" } });
});

test("a first-run server sends visitors to the setup page", async () => {
  server.use(http.get(url("/api/v1/auth/setup"), () => HttpResponse.json({ needs_setup: true })));
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "Welcome to Thule" })).toBeInTheDocument();
});

test("the account's language stays on the device after signing out", async () => {
  serverWithAccount({ language: "ru" });
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
  const { user } = renderApp("/");
  await user.click(await screen.findByRole("button", { name: "Выйти" }));
  expect(await screen.findByRole("heading", { name: "Вход" })).toBeInTheDocument();
  expect(localStorage.getItem("thule.language")).toBe("ru");
});

test("a language the server refused to save is switched back", async () => {
  serverWithAccount();
  server.use(http.patch(url("/api/v1/me/preferences"), () => HttpResponse.error()));
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
  const { user } = renderApp("/");
  await user.click(await screen.findByRole("button", { name: "Русский" }));
  expect(await screen.findByText("Signed in as")).toBeInTheDocument();
});
