import { focusManager } from "@tanstack/react-query";
import { act, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { mockAccount, renderSignedIn } from "../test/account";
import { apiError, tokenPair, url } from "../test/api";
import { renderApp } from "../test/render";
import { server } from "../test/server";
import { REFRESH_TOKEN_KEY } from "./tokens";

const serverWithAccount = (preferences = {}) => mockAccount({ preferences }).calls;
const greeting = { level: 1, name: /Ada Lovelace/ } as const;

test("signing in opens the app; signing out returns to the sign-in page", async () => {
  const calls = serverWithAccount();
  const { user } = renderApp("/");
  await user.type(await screen.findByLabelText("Username"), " ada ");
  await user.type(screen.getByLabelText("Password"), "secret-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  expect(await screen.findByRole("heading", greeting)).toBeInTheDocument();
  expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-1");
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/api/v1/auth/login",
    body: { username: "ada", password: "secret-password" },
  });

  await user.click(screen.getByRole("button", { name: "Account: Ada Lovelace" }));
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("You signed out.");
  expect(calls.at(-1)).toEqual({
    method: "POST",
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
  expect(await screen.findByRole("heading", greeting)).toBeInTheDocument();
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
  expect(await screen.findByRole("heading", greeting)).toBeInTheDocument();
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
  renderSignedIn("/settings");
  expect(await screen.findByRole("heading", { name: "Настройки" })).toBeInTheDocument();
});

test("a language chosen while signed in is saved to the account", async () => {
  const calls = serverWithAccount();
  const { user } = renderSignedIn("/settings");
  await user.click(await screen.findByRole("radio", { name: "Русский" }));
  expect(screen.getByRole("heading", { name: "Настройки" })).toBeInTheDocument();
  expect(calls).toContainEqual({
    method: "PATCH",
    path: "/api/v1/me/preferences",
    body: { language: "ru" },
  });
});

test("a language changed on another device applies when the user comes back", async () => {
  const { state } = mockAccount();
  renderSignedIn("/settings");
  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  state.preferences.language = "ru";
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  expect(await screen.findByRole("heading", { name: "Настройки" })).toBeInTheDocument();
});

test("a first-run server sends visitors to the setup page", async () => {
  server.use(http.get(url("/api/v1/auth/setup"), () => HttpResponse.json({ needs_setup: true })));
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "Welcome to Thule" })).toBeInTheDocument();
});

test("the account's language stays on the device after signing out", async () => {
  serverWithAccount({ language: "ru" });
  const { user } = renderSignedIn("/");
  await user.click(await screen.findByRole("button", { name: "Аккаунт: Ada Lovelace" }));
  await user.click(screen.getByRole("menuitem", { name: "Выйти" }));
  expect(await screen.findByRole("heading", { name: "Вход" })).toBeInTheDocument();
  expect(localStorage.getItem("thule.language")).toBe("ru");
});

test("a language the server refused to save is switched back", async () => {
  serverWithAccount();
  server.use(http.patch(url("/api/v1/me/preferences"), () => apiError("http_error", 500)));
  const { user } = renderSignedIn("/settings");
  await user.click(await screen.findByRole("radio", { name: "Русский" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the change.");
  expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
});
