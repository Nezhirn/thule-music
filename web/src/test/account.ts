// A mock server with one account, `ada` (password "secret-password"), whose profile and
// settings change as the app changes them.
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { REFRESH_TOKEN_KEY } from "../auth/tokens";
import { ADA, apiError, PREFERENCES, tokenPair, url } from "./api";
import { renderApp } from "./render";
import { server } from "./server";

type Preferences = Schemas["Preferences"];

export const PASSWORD = "secret-password";
export const AVATAR_ID = "00000000-0000-0000-0000-00000000a7a7";

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

export function mockAccount({
  me = {},
  preferences = {},
}: { me?: Partial<Schemas["UserOut"]>; preferences?: Partial<Preferences> } = {}) {
  const state = { me: { ...ADA, ...me }, preferences: { ...PREFERENCES, ...preferences } };
  const calls: Call[] = [];
  let issued = 1;
  const record = async (request: Request) => {
    const type = request.headers.get("content-type") ?? "";
    const body = type.includes("json")
      ? await request.clone().json()
      : type.includes("multipart")
        ? Object.fromEntries(await request.clone().formData())
        : null;
    calls.push({ method: request.method, path: new URL(request.url).pathname, body });
  };

  server.use(
    http.get(url("/api/v1/auth/setup"), () => HttpResponse.json({ needs_setup: false })),
    http.post(url("/api/v1/auth/login"), async ({ request }) => {
      await record(request);
      const { password } = (await request.json()) as Schemas["Credentials"];
      return password === PASSWORD
        ? HttpResponse.json(tokenPair(issued))
        : apiError("invalid_credentials", 401);
    }),
    http.post(url("/api/v1/auth/refresh"), () => HttpResponse.json(tokenPair(++issued))),
    http.post(url("/api/v1/auth/logout"), async ({ request }) => {
      await record(request);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(url("/api/v1/auth/me"), () => HttpResponse.json(state.me)),
    http.patch(url("/api/v1/auth/me"), async ({ request }) => {
      await record(request);
      const { display_name } = (await request.json()) as Schemas["ProfilePatch"];
      state.me = { ...state.me, display_name: display_name?.trim() || null };
      return HttpResponse.json(state.me);
    }),
    http.put(url("/api/v1/auth/me/avatar"), async ({ request }) => {
      await record(request);
      state.me = { ...state.me, avatar_id: AVATAR_ID };
      return HttpResponse.json(state.me);
    }),
    http.delete(url("/api/v1/auth/me/avatar"), async ({ request }) => {
      await record(request);
      state.me = { ...state.me, avatar_id: null };
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(url("/api/v1/auth/me/password"), async ({ request }) => {
      await record(request);
      const body = (await request.json()) as Schemas["PasswordChange"];
      return body.current_password === PASSWORD
        ? HttpResponse.json(tokenPair(++issued))
        : apiError("wrong_password", 400);
    }),
    http.get(url("/api/v1/me/preferences"), () => HttpResponse.json(state.preferences)),
    http.patch(url("/api/v1/me/preferences"), async ({ request }) => {
      await record(request);
      const change = (await request.json()) as Partial<Preferences>;
      state.preferences = { ...state.preferences, ...change };
      return HttpResponse.json(state.preferences);
    }),
  );
  return { state, calls };
}

/** The app at `path`, with a stored session to restore. */
export function renderSignedIn(path = "/") {
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-1");
  return renderApp(path);
}
