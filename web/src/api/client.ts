import { getAccessToken, renewAccessToken } from "../auth/tokens";
import { newClient } from "./base";

export type { Schemas } from "./base";

// Endpoints that work without a session; they don't wait for a token renewal.
const PUBLIC = new Set([
  "/api/v1/auth/setup",
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
]);

// Copies of authorised requests, taken before sending, to repeat them with a renewed token.
const pending = new WeakMap<Request, { copy: Request; token: string }>();

/** The API client. Adds the access token, renewing it when it is about to expire, and
 * repeats a request once if the server rejected the token anyway. */
export const api = newClient();

api.use({
  async onRequest({ request, schemaPath }) {
    if (PUBLIC.has(schemaPath)) return undefined;
    const token = await getAccessToken();
    if (token === null) return undefined;
    request.headers.set("Authorization", `Bearer ${token}`);
    pending.set(request, { copy: request.clone(), token });
    return request;
  },
  async onResponse({ request, response }) {
    const sent = pending.get(request);
    if (response.status !== 401 || !sent) return undefined;
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if ((body as { code?: string } | null)?.code !== "invalid_token") return undefined;
    // Rejected before its expiry by our clock: a skewed clock, a laptop back from sleep, a
    // server restarted with a new key. Renew once and repeat.
    const token = await renewAccessToken(sent.token);
    if (token === null) return undefined;
    sent.copy.headers.set("Authorization", `Bearer ${token}`);
    return globalThis.fetch(sent.copy);
  },
});
