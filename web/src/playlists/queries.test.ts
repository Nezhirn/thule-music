import { QueryClient } from "@tanstack/react-query";
import { album, track, WIND } from "../test/catalog";
import { changePlaylist, moveItem, playlistQuery, withItems, type PlaylistDetail } from "./queries";

const ALBUM = album("Ветер", WIND);
const PLAYLIST: PlaylistDetail = withItems(
  {
    id: "p1",
    name: "В дорогу",
    description: null,
    track_count: 0,
    duration_ms: 0,
    cover_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    items: [],
  },
  ["A", "B", "C"].map((title) => ({
    item_id: title,
    position: 0,
    added_at: "2026-01-01T00:00:00Z",
    track: track(title, ALBUM),
  })),
);

const order = (playlist: PlaylistDetail | undefined) =>
  playlist?.items.map((item) => item.item_id).join("");

test("changes reach the server one after another; its answer shows once the last is in", async () => {
  const queryClient = new QueryClient();
  const { queryKey } = playlistQuery("p1");
  queryClient.setQueryData(queryKey, PLAYLIST);
  const answers: ((playlist: PlaylistDetail) => void)[] = [];
  const send = () => new Promise<PlaylistDetail>((resolve) => answers.push(resolve));

  const first = changePlaylist(queryClient, "p1", send, (p) => moveItem(p, 0, 2));
  const second = changePlaylist(queryClient, "p1", send, (p) => moveItem(p, 0, 1));
  await vi.waitFor(() => expect(order(queryClient.getQueryData(queryKey))).toBe("CBA"));
  // The second waits for the first.
  expect(answers).toHaveLength(1);

  // The first answer is not the latest state: the optimistic one stays.
  answers[0]!(moveItem(PLAYLIST, 0, 2));
  await first;
  expect(order(queryClient.getQueryData(queryKey))).toBe("CBA");
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  answers[1]!(withItems(PLAYLIST, [...moveItem(moveItem(PLAYLIST, 0, 2), 0, 1).items]));
  await second;
  expect(order(queryClient.getQueryData(queryKey))).toBe("CBA");
});

test("a refused change loads the playlist again", async () => {
  const queryClient = new QueryClient();
  const { queryKey } = playlistQuery("p2");
  queryClient.setQueryData(queryKey, { ...PLAYLIST, id: "p2" });
  const refetch = vi.spyOn(queryClient, "invalidateQueries");
  await expect(
    changePlaylist(
      queryClient,
      "p2",
      () => Promise.reject(new Error("offline")),
      (p) => withItems(p, []),
    ),
  ).rejects.toThrow("offline");
  expect(refetch).toHaveBeenCalledWith({ queryKey, exact: true });
});
