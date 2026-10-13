import { http, HttpResponse } from "msw";
import { startSession } from "../auth/tokens";
import { ADA, apiError, tokenPair, url } from "../test/api";
import { server } from "../test/server";
import { api } from "./client";

test("requests carry the access token; public endpoints go without", async () => {
  const seen: Record<string, string | null> = {};
  server.use(
    http.get(url("/api/v1/auth/me"), ({ request }) => {
      seen.me = request.headers.get("Authorization");
      return HttpResponse.json(ADA);
    }),
    http.get(url("/api/v1/auth/setup"), ({ request }) => {
      seen.setup = request.headers.get("Authorization");
      return HttpResponse.json({ needs_setup: false });
    }),
  );
  startSession(tokenPair(1));
  await api.GET("/api/v1/auth/me");
  await api.GET("/api/v1/auth/setup");
  expect(seen).toEqual({ me: "Bearer access-1", setup: null });
});

test("a request whose token was rejected is repeated once with a renewed token", async () => {
  let refreshes = 0;
  server.use(
    http.post(url("/api/v1/auth/refresh"), () => {
      refreshes++;
      return HttpResponse.json(tokenPair(2));
    }),
    http.patch(url("/api/v1/auth/me"), async ({ request }) => {
      if (request.headers.get("Authorization") !== "Bearer access-2") {
        return apiError("invalid_token", 401);
      }
      return HttpResponse.json({ ...ADA, ...((await request.json()) as object) });
    }),
  );
  startSession(tokenPair(1));
  const { data } = await api.PATCH("/api/v1/auth/me", { body: { display_name: "Ada" } });
  expect(data?.display_name).toBe("Ada"); // the body was sent again too
  expect(refreshes).toBe(1);
});

test("other refusals are not retried", async () => {
  let calls = 0;
  server.use(
    http.get(url("/api/v1/users"), () => {
      calls++;
      return apiError("admin_only", 403);
    }),
  );
  startSession(tokenPair(1));
  const { error } = await api.GET("/api/v1/users");
  expect(error?.code).toBe("admin_only");
  expect(calls).toBe(1);
});
