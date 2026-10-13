import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api, type Schemas } from "../api/client";
import { unwrap } from "../api/errors";

export type SearchKind = Schemas["SearchType"];
export type Found = Schemas["SearchOut"];
/** What was found, and for what: the results of the query before stay on screen until the
 * new ones come. */
export type Results = Found & { query: string };

export const SEARCH_KINDS: readonly SearchKind[] = ["tracks", "albums", "artists"];

/** Of each kind, for the overview of everything found. */
export const FEW = 10;
/** Of one kind per page (the most the server gives at once). */
export const SEARCH_PAGE = 50;

// The catalogue changes only with a scan: going back to the results doesn't search again.
const staleTime = 5 * 60_000;

/** A few artists, albums and tracks matching `q`. A newer query cancels the request of the
 * one typed before it. */
export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: ["search", q],
    queryFn: async ({ signal }): Promise<Results> => ({
      query: q,
      ...(await unwrap(
        api.GET("/api/v1/search", { params: { query: { q, limit: FEW } }, signal }),
      )),
    }),
    staleTime,
  });

/** Everything of one kind matching `q`, page by page. */
export const searchKindQuery = (q: string, kind: SearchKind) =>
  infiniteQueryOptions({
    queryKey: ["search", q, kind],
    queryFn: ({ pageParam, signal }) =>
      unwrap(
        api.GET("/api/v1/search", {
          params: { query: { q, type: kind, limit: SEARCH_PAGE, offset: pageParam } },
          signal,
        }),
      ),
    initialPageParam: 0,
    // A short page is the last one.
    getNextPageParam: (last: Found, pages: Found[]) =>
      last[kind].length < SEARCH_PAGE ? undefined : pages.length * SEARCH_PAGE,
    staleTime,
  });
