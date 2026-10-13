import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api, type Schemas } from "../api/client";
import { unwrap } from "../api/errors";

export type Playlist = Schemas["PlaylistOut"];
export type PlaylistDetail = Schemas["PlaylistDetail"];

/** The user's playlists, last changed first: the sidebar, the library, "Add to playlist". */
export const playlistsQuery = queryOptions({
  queryKey: ["playlists"],
  queryFn: () => unwrap(api.GET("/api/v1/playlists")),
});

export const playlistQuery = (id: string) =>
  queryOptions({
    queryKey: ["playlists", id],
    queryFn: () =>
      unwrap(api.GET("/api/v1/playlists/{playlist_id}", { params: { path: { playlist_id: id } } })),
  });

// Per playlist: changes still on their way, and the last of them. They go one after another,
// so the server makes them in the order they were made.
const pending = new Map<string, { count: number; last: Promise<unknown> }>();

/** Changes a playlist on the server: `optimistic` shows the change at once. The playlist as
 * the server has it replaces it when the last change on its way is done; if one fails, the
 * playlist loads again. */
export async function changePlaylist(
  queryClient: QueryClient,
  id: string,
  send: () => Promise<PlaylistDetail>,
  optimistic?: (playlist: PlaylistDetail) => PlaylistDetail,
): Promise<PlaylistDetail> {
  const { queryKey } = playlistQuery(id);
  // In line at once, so changes go in the order they were made.
  const queue = pending.get(id) ?? { count: 0, last: Promise.resolve() };
  pending.set(id, queue);
  queue.count += 1;
  const sent = queue.last.then(send);
  queue.last = sent.catch(() => {});
  if (optimistic) {
    // A load on its way would bring the playlist without the change.
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData(queryKey, (playlist) => playlist && optimistic(playlist));
  }
  const done = () => {
    queue.count -= 1;
    if (queue.count === 0) pending.delete(id);
    // The sidebar: its order (last changed first) and the counts.
    void queryClient.invalidateQueries({ queryKey: playlistsQuery.queryKey, exact: true });
    return queue.count === 0;
  };
  try {
    const playlist = await sent;
    if (done()) queryClient.setQueryData(queryKey, playlist);
    return playlist;
  } catch (error) {
    done();
    void queryClient.invalidateQueries({ queryKey, exact: true });
    throw error;
  }
}

/** The playlist with its items in a new order, numbered again. */
export function withItems(
  playlist: PlaylistDetail,
  items: PlaylistDetail["items"],
): PlaylistDetail {
  return {
    ...playlist,
    items: items.map((item, position) => ({ ...item, position })),
    track_count: items.length,
    duration_ms: items.reduce((sum, item) => sum + item.track.duration_ms, 0),
  };
}

export function moveItem(playlist: PlaylistDetail, from: number, to: number): PlaylistDetail {
  const items = [...playlist.items];
  const [moved] = items.splice(from, 1);
  if (moved) items.splice(to, 0, moved);
  return withItems(playlist, items);
}
