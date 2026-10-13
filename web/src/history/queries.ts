import { infiniteQueryOptions } from "@tanstack/react-query";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { PAGE } from "../catalog/queries";

/** Every play, newest first, a page at a time: each page starts after the last play of the
 * one before. */
export const historyQuery = infiniteQueryOptions({
  queryKey: ["history"],
  queryFn: ({ pageParam }) =>
    unwrap(
      api.GET("/api/v1/me/history", {
        params: { query: { limit: PAGE, before: pageParam } },
      }),
    ),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.next,
});
