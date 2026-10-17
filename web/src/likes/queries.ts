import { infiniteQueryOptions } from "@tanstack/react-query";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { filterParams, NO_FILTERS, type Filters } from "../catalog/filters";
import { offsetPaging, PAGE, type Track } from "../catalog/queries";

// Not kept fresh for long like the catalogue: likes change from other devices too.

export const likedTracksQuery = (filters: Filters = NO_FILTERS) =>
  infiniteQueryOptions({
    queryKey: ["likes", "track", filters],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/me/likes/tracks", {
          params: { query: { ...filterParams(filters), limit: PAGE, offset: pageParam } },
        }),
      ),
    ...offsetPaging,
  });

export const favouriteAlbumsQuery = (filters: Filters = NO_FILTERS) =>
  infiniteQueryOptions({
    queryKey: ["likes", "album", filters],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/me/likes/albums", {
          params: { query: { ...filterParams(filters), limit: PAGE, offset: pageParam } },
        }),
      ),
    ...offsetPaging,
  });

export const favouriteArtistsQuery = (filters: Filters = NO_FILTERS) =>
  infiniteQueryOptions({
    queryKey: ["likes", "artist", filters],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/me/likes/artists", {
          params: { query: { ...filterParams(filters), limit: PAGE, offset: pageParam } },
        }),
      ),
    ...offsetPaging,
  });

/** Every liked song (those `filters` leave), for playing them all: the page shows them a
 * page at a time. */
export async function allLikedTracks(filters: Filters = NO_FILTERS): Promise<Track[]> {
  const tracks: Track[] = [];
  for (;;) {
    const page = await unwrap(
      api.GET("/api/v1/me/likes/tracks", {
        params: { query: { ...filterParams(filters), limit: 500, offset: tracks.length } },
      }),
    );
    tracks.push(...page.items);
    if (page.items.length === 0 || tracks.length >= page.total) return tracks;
  }
}
