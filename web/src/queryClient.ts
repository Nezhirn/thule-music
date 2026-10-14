import { QueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { ApiFailure, isTransient } from "./api/errors";

// Tries of a query after the first; between them, a second, two, four (or what the server
// asks for with Retry-After, up to half a minute).
const RETRIES = 3;
const MAX_RETRY_DELAY = 30_000;

export function retryDelay(failures: number, error: unknown): number {
  if (error instanceof ApiFailure && error.retryAfter) {
    return Math.min(error.retryAfter * 1000, MAX_RETRY_DELAY);
  }
  return Math.min(1000 * 2 ** failures, MAX_RETRY_DELAY);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // No answer, or a "not now" (502 while the server restarts, 503, 429): asked again a
        // few times. Any other error response won't change by asking again.
        retry: (failures, error) => isTransient(error) && failures < RETRIES,
        retryDelay,
      },
    },
  });
}

/** Marks what `queryKey` matches as out of date without loading it again now: a list on
 * screen doesn't change under the reader, the next visit loads it fresh. A long list not
 * on screen keeps only its first page, so that visit asks for one page, not every page that
 * was shown before, one after another. */
export function refreshLater(queryClient: QueryClient, queryKey: QueryKey) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey, type: "inactive" })) {
    const data = query.state.data as InfiniteData<unknown> | undefined;
    if (data && Array.isArray(data.pages) && data.pages.length > 1) {
      queryClient.setQueryData<InfiniteData<unknown>>(
        query.queryKey,
        { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
        { updatedAt: query.state.dataUpdatedAt },
      );
    }
  }
  void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
}
