// A mock of the administration API: the library's numbers, scans, jobs, uploads and users,
// whose state a test can change as the server would.
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { ADA, apiError, url } from "./api";
import type { Call } from "./account";
import { server } from "./server";

type AdminUser = Schemas["UserAdminOut"];
type Job = Schemas["JobOut"];

export const LISTENER: AdminUser = {
  id: "00000000-0000-0000-0000-0000000000b2",
  username: "grace",
  display_name: "Grace Hopper",
  role: "user",
  avatar_id: null,
  created_at: "2026-02-01T00:00:00Z",
  last_seen_at: "2026-10-12T09:00:00Z",
  sessions: 2,
};

export function failedJob(kind: string, subject: string | null, error: string): Job {
  return {
    id: crypto.randomUUID(),
    kind,
    status: "failed",
    payload: {},
    attempts: 3,
    max_attempts: 3,
    error,
    created_at: "2026-10-13T08:00:00Z",
    finished_at: "2026-10-13T08:01:00Z",
    subject,
  };
}

const idle = (): Schemas["JobSummary"] => ({ kinds: {}, pending: 0, failed: 0 });

export function mockAdmin({
  failed = [],
  users = [{ ...ADA, last_seen_at: new Date().toISOString(), sessions: 1 }, LISTENER],
}: { failed?: Job[]; users?: AdminUser[] } = {}) {
  const state = {
    stats: { artists: 18, albums: 14, tracks: 43, duration_ms: 25_020_000, size_bytes: 12_568_659 },
    scan: null as Schemas["ScanOut"] | null,
    summary: { ...idle(), failed: failed.length },
    failed,
    users,
    /** How the import of each uploaded path is going. */
    imports: new Map<string, Schemas["ImportStatus"]>(),
  };
  const calls: Call[] = [];
  const record = (request: Request, body: unknown = null) =>
    calls.push({ method: request.method, path: new URL(request.url).pathname, body });

  server.use(
    http.get(url("/api/v1/library/stats"), () => HttpResponse.json(state.stats)),
    http.get(url("/api/v1/library/scan"), () => HttpResponse.json(state.scan)),
    http.post(url("/api/v1/library/scan"), ({ request }) => {
      record(request);
      state.scan = {
        id: "00000000-0000-0000-0000-00000000005c",
        status: "queued",
        created_at: new Date().toISOString(),
        finished_at: null,
        error: null,
        result: null,
        imports: { queued: 0, running: 0, done: 0, failed: 0 },
      };
      return HttpResponse.json(state.scan, { status: 202 });
    }),
    http.get(url("/api/v1/library/jobs/summary"), () => HttpResponse.json(state.summary)),
    http.get(url("/api/v1/library/jobs"), ({ request }) => {
      const params = new URL(request.url).searchParams;
      const offset = Number(params.get("offset") ?? 0);
      const limit = Number(params.get("limit") ?? 50);
      return HttpResponse.json({
        items: state.failed.slice(offset, offset + limit),
        total: state.failed.length,
        limit,
        offset,
      });
    }),
    http.post(url("/api/v1/library/jobs/retry"), ({ request }) => {
      record(request);
      const retried = state.failed.length;
      state.failed = [];
      state.summary = { ...state.summary, failed: 0 };
      return HttpResponse.json({ retried });
    }),
    http.post(url("/api/v1/library/jobs/:id/retry"), ({ request, params }) => {
      record(request);
      if (!state.failed.some((job) => job.id === params.id)) return apiError("job_not_found", 404);
      state.failed = state.failed.filter((job) => job.id !== params.id);
      state.summary = { ...state.summary, failed: state.failed.length };
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(url("/api/v1/library/jobs/failed"), ({ request }) => {
      record(request);
      state.failed = [];
      state.summary = { ...state.summary, failed: 0 };
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(url("/api/v1/library/uploads"), async ({ request }) => {
      const form = await request.formData();
      const folder = String(form.get("folder") ?? "");
      // jsdom sends every file as "blob": the tests put the name in the content.
      const name = await (form.get("files") as File).text();
      const file = { name };
      record(request, { folder, name });
      // Files named "dup ..." are in the library already.
      const duplicate = file.name.startsWith("dup");
      const path = duplicate
        ? `Library/${file.name}`
        : ["uploads", folder, file.name].filter(Boolean).join("/");
      return HttpResponse.json([{ path, duplicate }], { status: 202 });
    }),
    http.post(url("/api/v1/library/uploads/status"), async ({ request }) => {
      const { paths } = (await request.json()) as Schemas["ImportStatusIn"];
      return HttpResponse.json(
        paths.map(
          (path) => state.imports.get(path) ?? { path, state: "queued", error: null, track: null },
        ),
      );
    }),
    http.get(url("/api/v1/users"), () => HttpResponse.json(state.users)),
    http.post(url("/api/v1/auth/register"), async ({ request }) => {
      const body = (await request.json()) as Schemas["RegisterIn"];
      record(request, body);
      if (state.users.some((user) => user.username === body.username)) {
        return apiError("username_taken", 409);
      }
      const created: AdminUser = {
        id: crypto.randomUUID(),
        username: body.username,
        display_name: body.display_name ?? null,
        role: body.role ?? "user",
        avatar_id: null,
        created_at: new Date().toISOString(),
        last_seen_at: null,
        sessions: 0,
      };
      state.users = [...state.users, created];
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch(url("/api/v1/users/:username"), async ({ request, params }) => {
      const body = (await request.json()) as Schemas["UserPatch"];
      record(request, body);
      state.users = state.users.map((user) =>
        user.username === params.username ? { ...user, role: body.role } : user,
      );
      return HttpResponse.json(state.users.find((user) => user.username === params.username));
    }),
    http.post(url("/api/v1/users/:username/password"), async ({ request }) => {
      record(request, await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(url("/api/v1/users/:username/sessions"), ({ request, params }) => {
      record(request);
      state.users = state.users.map((user) =>
        user.username === params.username ? { ...user, sessions: 0 } : user,
      );
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete(url("/api/v1/users/:username"), ({ request, params }) => {
      record(request);
      state.users = state.users.filter((user) => user.username !== params.username);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { state, calls };
}
