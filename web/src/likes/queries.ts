import { infiniteQueryOptions } from "@tanstack/react-query";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { offsetPaging, PAGE, type Track } from "../catalog/queries";

// Not kept fresh for long like the catalogue: likes change from other devices too.

export const likedTracksQuery = infiniteQueryOptions({
  queryKey: ["likes", "track"],
  queryFn: ({ pageParam }) =>
    unwrap(
      api.GET("/api/v1/me/likes/tracks", { params: { query: { limit: PAGE, offset: pageParam } } }),
    ),
  ...offsetPaging,
});

export const favouriteAlbumsQuery = infiniteQueryOptions({
  queryKey: ["likes", "album"],
  queryFn: ({ pageParam }) =>
    unwrap(
      api.GET("/api/v1/me/likes/albums", { params: { query: { limit: PAGE, offset: pageParam } } }),
    ),
  ...offsetPaging,
});

export const favouriteArtistsQuery = infiniteQueryOptions({
  queryKey: ["likes", "artist"],
  queryFn: ({ pageParam }) =>
    unwrap(
      api.GET("/api/v1/me/likes/artists", {
        params: { query: { limit: PAGE, offset: pageParam } },
      }),
    ),
  ...offsetPaging,
});

/** Every liked song, for playing them all: the page shows them a page at a time. */
export async function allLikedTracks(): Promise<Track[]> {
  const tracks: Track[] = [];
  for (;;) {
    const page = await unwrap(
      api.GET("/api/v1/me/likes/tracks", {
        params: { query: { limit: 500, offset: tracks.length } },
      }),
    );
    tracks.push(...page.items);
    if (page.items.length === 0 || tracks.length >= page.total) return tracks;
  }
}
