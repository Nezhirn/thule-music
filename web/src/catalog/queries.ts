import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import type { Schemas } from "../api/client";

export type Album = Schemas["AlbumOut"];
export type Artist = Schemas["ArtistOut"];
export type Track = Schemas["TrackOut"];
export type AlbumSort = Schemas["AlbumSort"];
export type TrackSort = Schemas["TrackSort"];

export const ALBUM_SORTS: readonly AlbumSort[] = ["added", "title", "year", "artist"];
export const TRACK_SORTS: readonly TrackSort[] = ["added", "title", "artist", "album"];

/** `value` if it is one of `options`: a sort order from the address. */
export function pick<T extends string>(value: string | null, options: readonly T[]): T | null {
  return options.includes(value as T) ? (value as T) : null;
}

/** Items per page of the long lists. */
export const PAGE = 60;

// The catalogue changes only with a scan; no need to refetch it every time a page is opened.
const staleTime = 5 * 60_000;

export const homeQuery = queryOptions({
  queryKey: ["home"],
  queryFn: () => unwrap(api.GET("/api/v1/home")),
  staleTime,
});

export const genresQuery = queryOptions({
  queryKey: ["genres"],
  queryFn: () => unwrap(api.GET("/api/v1/genres")),
  staleTime,
});

export const albumQuery = (id: string) =>
  queryOptions({
    queryKey: ["album", id],
    queryFn: () =>
      unwrap(api.GET("/api/v1/albums/{album_id}", { params: { path: { album_id: id } } })),
    staleTime,
  });

export const artistQuery = (id: string) =>
  queryOptions({
    queryKey: ["artist", id],
    queryFn: () =>
      unwrap(api.GET("/api/v1/artists/{artist_id}", { params: { path: { artist_id: id } } })),
    staleTime,
  });

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Paging by offset: the next page starts after the items so far, until there are `total`. */
export const offsetPaging = {
  initialPageParam: 0,
  getNextPageParam: <T>(last: Paged<T>) =>
    last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined,
};

const paging = { ...offsetPaging, staleTime };

export const albumsQuery = (sort: AlbumSort, genre: string | null) =>
  infiniteQueryOptions({
    queryKey: ["albums", sort, genre],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/albums", {
          params: { query: { sort, genre, limit: PAGE, offset: pageParam } },
        }),
      ),
    ...paging,
  });

export const artistsQuery = infiniteQueryOptions({
  queryKey: ["artists"],
  queryFn: ({ pageParam }) =>
    unwrap(api.GET("/api/v1/artists", { params: { query: { limit: PAGE, offset: pageParam } } })),
  ...paging,
});

export const tracksQuery = (sort: TrackSort) =>
  infiniteQueryOptions({
    queryKey: ["tracks", sort],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/tracks", {
          params: { query: { sort, limit: PAGE, offset: pageParam } },
        }),
      ),
    ...paging,
  });
