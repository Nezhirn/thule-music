import { http, HttpResponse } from "msw";
import { apiError, tokenPair, url } from "../test/api";
import { server } from "../test/server";
import {
  getAccessToken,
  REFRESH_TOKEN_KEY,
  renewAccessToken,
  signOut,
  startSession,
  subscribe,
  type SessionEvent,
} from "./tokens";

/** Answers refreshes with successive token pairs; records the tokens presented. */
function refreshServer(first = 1) {
  const presented: string[] = [];
  let next = first;
  server.use(
    http.post(url("/api/v1/auth/refresh"), async ({ request }) => {
      const { refresh_token } = (await request.json()) as { refresh_token: string };
      presented.push(refresh_token);
      return HttpResponse.json(tokenPair(next++));
    }),
  );
  return presented;
}

function events() {
  const seen: SessionEvent[] = [];
  const unsubscribe = subscribe((event) => seen.push(event));
  onTestFinished(unsubscribe);
  return seen;
}

test("without a session there is no token and no request", async () => {
  expect(await getAccessToken()).toBeNull();
});

test("concurrent callers share one refresh", async () => {
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-0");
  const presented = refreshServer();
  const tokens = await Promise.all([getAccessToken(), getAccessToken(), getAccessToken()]);
  expect(tokens).toEqual(["access-1", "access-1", "access-1"]);
  expect(presented).toEqual(["refresh-0"]);
  expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-1");
});

test("the refresh token is read from storage when used: another tab may have rotated it", async () => {
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-0");
  const presented = refreshServer();
  await getAccessToken();
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-from-other-tab");
  expect(await renewAccessToken("access-1")).toBe("access-2");
  expect(presented).toEqual(["refresh-0", "refresh-from-other-tab"]);
});

test("a token renewed meanwhile is not renewed again", async () => {
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-0");
  const presented = refreshServer();
  await getAccessToken();
  await renewAccessToken("access-1");
  // A request sent with access-1 failed after the renewal above: no need to refresh again.
  expect(await renewAccessToken("access-1")).toBe("access-2");
  expect(presented).toHaveLength(2);
});

test("refreshes are serialised across tabs with a Web Lock", async () => {
  const request = vi.fn((_name: string, task: () => Promise<unknown>) => task());
  vi.stubGlobal("navigator", { ...navigator, locks: { request } });
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-0");
  refreshServer();
  expect(await getAccessToken()).toBe("access-1");
  expect(request).toHaveBeenCalledWith("thule.refresh", expect.any(Function));
});

test("the access token is renewed shortly before it expires", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const presented = refreshServer(2);
  startSession(tokenPair(1, 60));
  expect(await getAccessToken()).toBe("access-1");
  vi.advanceTimersByTime(31_000);
  expect(await getAccessToken()).toBe("access-2");
  expect(presented).toEqual(["refresh-1"]);
});

test("an unreachable server keeps the session", async () => {
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-0");
  server.use(http.post(url("/api/v1/auth/refresh"), () => HttpResponse.error()));
  await expect(getAccessToken()).rejects.toThrow();
  expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe("refresh-0");
});

test.each([
  ["refresh_token_expired", "expired"],
  ["invalid_refresh_token", "expired"],
  ["refresh_token_reused", "revoked"],
] as const)("a refresh refused with %s ends the session as %s", async (code, reason) => {
  const seen = events();
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-0");
  server.use(http.post(url("/api/v1/auth/refresh"), () => apiError(code, 401)));
  expect(await getAccessToken()).toBeNull();
  expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  expect(seen).toEqual([{ type: "ended", reason }]);
});

test("after losing a refresh race, a tab continues with the token the winner stored", async () => {
  const seen = events();
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-0");
  server.use(
    http.post(url("/api/v1/auth/refresh"), async ({ request }) => {
      const { refresh_token } = (await request.json()) as { refresh_token: string };
      if (refresh_token !== "refresh-0") return HttpResponse.json(tokenPair(10));
      // The other tab got here first and stores its new token a moment later.
      setTimeout(() => localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-9"), 150);
      return apiError("refresh_token_rotated", 401);
    }),
  );
  expect(await getAccessToken()).toBe("access-10");
  expect(seen).toEqual([]);
});

test("a rotated token that nobody replaced ends the session", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
  const seen = events();
  localStorage.setItem(REFRESH_TOKEN_KEY, "refresh-0");
  server.use(http.post(url("/api/v1/auth/refresh"), () => apiError("refresh_token_rotated", 401)));
  const token = getAccessToken();
  await vi.advanceTimersByTimeAsync(6_000);
  expect(await token).toBeNull();
  expect(seen).toEqual([{ type: "ended", reason: "expired" }]);
});

test("signing out revokes the token on the server and ends the session", async () => {
  const seen = events();
  const revoked: unknown[] = [];
  server.use(
    http.post(url("/api/v1/auth/logout"), async ({ request }) => {
      revoked.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
  );
  startSession(tokenPair(1));
  await signOut();
  expect(revoked).toEqual([{ refresh_token: "refresh-1" }]);
  expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  expect(seen).toEqual([{ type: "ended", reason: "signed-out" }]);
  expect(await getAccessToken()).toBeNull();
});

test("signing in or out in another tab is reported", async () => {
  const seen = events();
  const storageEvent = (oldValue: string | null, newValue: string | null) => {
    if (newValue === null) localStorage.removeItem(REFRESH_TOKEN_KEY);
    else localStorage.setItem(REFRESH_TOKEN_KEY, newValue);
    window.dispatchEvent(
      new StorageEvent("storage", { key: REFRESH_TOKEN_KEY, oldValue, newValue }),
    );
  };
  storageEvent(null, "refresh-1");
  storageEvent("refresh-1", "refresh-2"); // a rotation: nothing to report
  storageEvent("refresh-2", null);
  expect(seen).toEqual([{ type: "started" }, { type: "ended", reason: "signed-out" }]);
});
