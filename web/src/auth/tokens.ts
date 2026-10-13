// The session's tokens. The refresh token lives in localStorage, shared by the tabs; each tab
// keeps its own short-lived access token in memory.
//
// The backend rotates the refresh token on every refresh and treats a rotated token that is
// presented again as stolen: it then ends every session of the user. So refreshes must not
// overlap. Within a tab callers share one promise; across tabs a Web Lock serialises them,
// and the token is read from storage inside the lock, since another tab may have rotated it.
// Web Locks exist only in secure contexts (HTTPS, localhost). Over plain HTTP two tabs can
// still collide: the server then answers `refresh_token_rotated` (a replay within seconds
// is not treated as theft) and the losing tab waits for the winner to store the new token.
import { newClient, type Schemas } from "../api/base";
import { ApiFailure } from "../api/errors";
import { storage } from "../lib/storage";

export const REFRESH_TOKEN_KEY = "thule.refreshToken";
const LOCK_NAME = "thule.refresh";
// Renew the access token this long before it expires, so requests don't race the expiry.
const EXPIRY_MARGIN_MS = 30_000;
// How long a tab that lost a refresh race waits for the winner to store the new token.
const HANDOVER_TIMEOUT_MS = 5_000;

/** Why a session ended: signed out (here or in another tab), expired or revoked by the
 * server, or ended everywhere because a stolen token was detected. */
export type EndReason = "signed-out" | "expired" | "revoked";
export type SessionEvent = { type: "ended"; reason: EndReason } | { type: "started" };

const auth = newClient();
let access: { token: string; expiresAt: number } | null = null;
let renewal: Promise<string | null> | null = null;
const listeners = new Set<(event: SessionEvent) => void>();

export function hasSession(): boolean {
  return storage.get(REFRESH_TOKEN_KEY) !== null;
}

/** Stores the tokens of a new session (after sign-in). */
export function startSession(tokens: Schemas["TokenPair"]): void {
  storage.set(REFRESH_TOKEN_KEY, tokens.refresh_token);
  access = { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

/** A valid access token, renewed first if it is missing or about to expire; null without a
 * session. Throws if the server can't be reached: the session may well be fine. */
export async function getAccessToken(): Promise<string | null> {
  if (!hasSession()) {
    access = null;
    return null;
  }
  if (access && access.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return access.token;
  return renew();
}

/** A new access token after the server rejected `rejected` before its expiry. */
export async function renewAccessToken(rejected: string): Promise<string | null> {
  if (access && access.token !== rejected) return access.token; // renewed meanwhile
  return renew();
}

/** Ends the session here and on the server (best effort: offline, it just ends here). */
export async function signOut(): Promise<void> {
  await serialized(async () => {
    const token = storage.get(REFRESH_TOKEN_KEY);
    end("signed-out");
    if (token !== null) {
      await auth.POST("/api/v1/auth/logout", { body: { refresh_token: token } }).catch(() => {});
    }
  });
}

/** Session events: ended (also by another tab or the server), or started in another tab. */
export function subscribe(listener: (event: SessionEvent) => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function renew(): Promise<string | null> {
  renewal ??= serialized(refresh).finally(() => {
    renewal = null;
  });
  return renewal;
}

async function serialized<T>(task: () => Promise<T>): Promise<T> {
  return navigator.locks ? await navigator.locks.request(LOCK_NAME, task) : await task();
}

async function refresh(): Promise<string | null> {
  let token = storage.get(REFRESH_TOKEN_KEY);
  while (token !== null) {
    const { data, error, response } = await auth.POST("/api/v1/auth/refresh", {
      body: { refresh_token: token },
    });
    if (data) {
      startSession(data);
      return data.access_token;
    }
    if (response.status !== 401) throw new ApiFailure(response, error);
    if (error?.code !== "refresh_token_rotated") {
      end(error?.code === "refresh_token_reused" ? "revoked" : "expired");
      return null;
    }
    // Another tab refreshed with this token a moment ago: continue with the one it stores.
    const next = await storedTokenOtherThan(token);
    if (next === token) {
      end("expired"); // nobody stored a successor: the token is dead
      return null;
    }
    token = next;
  }
  end("signed-out");
  return null;
}

/** The stored refresh token once it differs from `previous` (null if signed out), or
 * `previous` if it hasn't changed within HANDOVER_TIMEOUT_MS. */
function storedTokenOtherThan(previous: string): Promise<string | null> {
  const deadline = Date.now() + HANDOVER_TIMEOUT_MS;
  return new Promise((resolve) => {
    const check = () => {
      const current = storage.get(REFRESH_TOKEN_KEY);
      if (current !== previous || Date.now() >= deadline) resolve(current);
      else setTimeout(check, 100);
    };
    check();
  });
}

function end(reason: EndReason): void {
  const had = access !== null || hasSession();
  access = null;
  storage.remove(REFRESH_TOKEN_KEY);
  if (had) notify({ type: "ended", reason });
}

function notify(event: SessionEvent): void {
  for (const listener of [...listeners]) listener(event);
}

// Another tab signed in or out (it doesn't fire for this tab's own writes).
function onStorage(event: StorageEvent): void {
  if (event.key !== REFRESH_TOKEN_KEY && event.key !== null) return; // null: storage cleared
  if (!hasSession()) {
    access = null;
    notify({ type: "ended", reason: "signed-out" });
  } else if (event.key !== null && event.oldValue === null) {
    notify({ type: "started" });
  }
}
