import { QueryClient } from "@tanstack/react-query";
import { dropFromLists, patchLiked, withLiked } from "./cache";

test("the like is changed wherever the item is, and nothing else is copied", () => {
  const other = { id: "b", title: "B", liked: false };
  const data = {
    album: { id: "a", liked: false, tracks: [{ id: "t", liked: true }, other] },
    pages: [{ items: [{ id: "t", liked: true, album: { id: "x" } }] }],
    untouched: { list: [1, 2] },
  };
  const next = withLiked(data, "t", false) as typeof data;
  expect(next.album.tracks[0]).toEqual({ id: "t", liked: false });
  expect(next.pages[0]!.items[0]).toEqual({ id: "t", liked: false, album: { id: "x" } });
  expect(next.album.tracks[1]).toBe(other);
  expect(next.untouched).toBe(data.untouched);
  expect(next.album.liked).toBe(false);
  // Nothing to change: the same data.
  expect(withLiked(next, "t", false)).toBe(next);
  expect(withLiked(data, "nothing", true)).toBe(data);
});

test("the cached pages are patched, as old as they were", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(["album", "a"], { id: "a", liked: false }, { updatedAt: 1000 });
  queryClient.setQueryData(["album", "b"], { id: "b", liked: false }, { updatedAt: 2000 });
  const before = queryClient.getQueryData(["album", "b"]);
  patchLiked(queryClient, "a", true);
  expect(queryClient.getQueryData(["album", "a"])).toEqual({ id: "a", liked: true });
  expect(queryClient.getQueryState(["album", "a"])?.dataUpdatedAt).toBe(1000);
  expect(queryClient.getQueryData(["album", "b"])).toBe(before);
});

test("an unliked item leaves the lists, and the pages after it start one earlier", () => {
  const queryClient = new QueryClient();
  const page = (offset: number, ids: string[]) => ({
    items: ids.map((id) => ({ id })),
    offset,
    limit: 2,
    total: 5,
  });
  queryClient.setQueryData(["likes", "track"], {
    pages: [page(0, ["a", "b"]), page(2, ["c", "d"]), page(4, ["e"])],
    pageParams: [0, 2, 4],
  });
  dropFromLists(queryClient, ["likes", "track"], "c");
  expect(queryClient.getQueryData(["likes", "track"])).toEqual({
    pages: [
      { ...page(0, ["a", "b"]), total: 4 },
      { ...page(2, ["d"]), total: 4 },
      { ...page(3, ["e"]), total: 4 },
    ],
    pageParams: [0, 2, 4],
  });
});
