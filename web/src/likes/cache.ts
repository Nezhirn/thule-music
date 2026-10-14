import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { Paged } from "../catalog/queries";

/** `data` with the like of what has id `id` (a track, album or artist, wherever it is in
 * it) set to `liked`; the same objects where nothing changed, so nothing else re-renders. */
export function withLiked(data: unknown, id: string, liked: boolean): unknown {
  if (data === null || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    let changed = false;
    const items = data.map((item: unknown) => {
      const next = withLiked(item, id, liked);
      changed ||= next !== item;
      return next;
    });
    return changed ? items : data;
  }
  const record = data as Record<string, unknown>;
  let result: Record<string, unknown> | null =
    record.id === id && typeof record.liked === "boolean" && record.liked !== liked
      ? { ...record, liked }
      : null;
  for (const [key, value] of Object.entries(record)) {
    if (value === null || typeof value !== "object") continue;
    const next = withLiked(value, id, liked);
    if (next !== value) (result ??= { ...record })[key] = next;
  }
  return result ?? data;
}

/** Every page loaded shows the like the server now has: the like changed on this device
 * needn't stand over them any more, and they don't load again for it. Kept as old as they
 * were, so they still load again when due (a change from another device). */
export function patchLiked(queryClient: QueryClient, id: string, liked: boolean) {
  for (const query of queryClient.getQueryCache().getAll()) {
    const data = query.state.data;
    if (data === undefined) continue;
    const next = withLiked(data, id, liked);
    if (next !== data) {
      queryClient.setQueryData(query.queryKey, next, { updatedAt: query.state.dataUpdatedAt });
    }
  }
}

/** The long lists `queryKey` matches without the item `id` (unliked), as the server now has
 * them, without loading every page again: the pages after it start one earlier, so loading
 * more doesn't skip one. */
export function dropFromLists(queryClient: QueryClient, queryKey: QueryKey, id: string) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey })) {
    const data = query.state.data as InfiniteData<Paged<{ id: string }>> | undefined;
    if (!data?.pages.some((page) => page.items.some((item) => item.id === id))) continue;
    let before = 0;
    const pages = data.pages.map((page) => {
      const items = page.items.filter((item) => item.id !== id);
      const shifted = { ...page, items, offset: page.offset - before, total: page.total - 1 };
      before += page.items.length - items.length;
      return shifted;
    });
    queryClient.setQueryData(
      query.queryKey,
      { ...data, pages },
      {
        updatedAt: query.state.dataUpdatedAt,
      },
    );
  }
}
