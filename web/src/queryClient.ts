import { QueryClient, type InfiniteData, type QueryKey } from "@tanstack/react-query";
import { ApiFailure } from "./api/errors";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retry network failures only: an error response won't change by asking again.
        retry: (failures, error) => !(error instanceof ApiFailure) && failures < 2,
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
