import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, type Schemas } from "../api/client";
import { unwrap } from "../api/errors";

export type Scan = Schemas["ScanOut"];
export type Job = Schemas["JobOut"];
export type JobSummary = Schemas["JobSummary"];
export type AdminUser = Schemas["UserAdminOut"];

/** How often the admin pages look again while the server is busy. */
export const BUSY_POLL_MS = 1000;
export const JOBS_PAGE = 20;

export const statsQuery = queryOptions({
  queryKey: ["admin", "stats"],
  queryFn: () => unwrap(api.GET("/api/v1/library/stats")),
});

export const scanQuery = queryOptions({
  queryKey: ["admin", "scan"],
  queryFn: () => unwrap(api.GET("/api/v1/library/scan")),
});

/** Background work: what is waiting or running, and what failed, by kind of job. */
export const summaryQuery = queryOptions({
  queryKey: ["admin", "summary"],
  queryFn: () => unwrap(api.GET("/api/v1/library/jobs/summary")),
});

export const failedJobsQuery = infiniteQueryOptions({
  queryKey: ["admin", "jobs", "failed"],
  queryFn: ({ pageParam }) =>
    unwrap(
      api.GET("/api/v1/library/jobs", {
        params: { query: { status: "failed", limit: JOBS_PAGE, offset: pageParam } },
      }),
    ),
  initialPageParam: 0,
  getNextPageParam: (last) =>
    last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined,
});

export const usersQuery = queryOptions({
  queryKey: ["admin", "users"],
  queryFn: () => unwrap(api.GET("/api/v1/users")),
});

/** Work left to do: queued or running. */
export const pendingOf = (counts: Schemas["JobCounts"] | undefined) =>
  counts ? counts.queued + counts.running : 0;

/** After the library changed (a scan or an upload finished): what shows it is out of date. */
export function libraryChanged(queryClient: QueryClient) {
  for (const key of [
    ["admin", "stats"],
    ["home"],
    ["genres"],
    ["albums"],
    ["album"],
    ["artists"],
    ["artist"],
    ["tracks"],
    ["search"],
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}
