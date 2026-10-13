// Building blocks for mocking the API in unit tests.
import { HttpResponse } from "msw";
import type { Schemas } from "../api/client";

export const url = (path: `/api/v1/${string}`) => `*${path}`;

export function apiError(code: Schemas["ErrorCode"], status: number, headers?: HeadersInit) {
  return HttpResponse.json<Schemas["ErrorOut"]>({ code, detail: code }, { status, headers });
}

export function tokenPair(n: number, expiresIn = 900): Schemas["TokenPair"] {
  return {
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    token_type: "bearer",
    expires_in: expiresIn,
  };
}

export const ADA: Schemas["UserOut"] = {
  id: "00000000-0000-0000-0000-000000000001",
  username: "ada",
  display_name: "Ada Lovelace",
  role: "admin",
  avatar_id: null,
  created_at: "2026-01-01T00:00:00Z",
};

export const PREFERENCES: Schemas["Preferences"] = {
  language: null,
  accent_color: null,
  blur: true,
  adaptive_color: true,
  stream_quality: "high",
};
