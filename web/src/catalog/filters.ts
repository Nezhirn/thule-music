import { queryOptions } from "@tanstack/react-query";
import { api, type Schemas } from "../api/client";
import { unwrap } from "../api/errors";

/** What a long list can be filtered by. */
export type Facet = "artist" | "album" | "genre";
export type FilterScope = Schemas["FilterScope"];
export type FilterOptions = Schemas["FilterOptions"];
export type FilterOption = Schemas["FilterOption"];

/** An artist's or album's id, a genre's name; null: not filtered by it. */
export type Filters = Record<Facet, string | null>;

export const NO_FILTERS: Filters = { artist: null, album: null, genre: null };

/** The filters in the address (?artist=<id>&album=<id>&genre=<name>), of those `facets`. */
export function filtersFrom(params: URLSearchParams, facets: readonly Facet[]): Filters {
  const filters = { ...NO_FILTERS };
  for (const facet of facets) filters[facet] = params.get(facet) || null;
  return filters;
}

export function isFiltered(filters: Filters): boolean {
  return Object.values(filters).some(Boolean);
}

/** The filters as the API takes them. */
export function filterParams(filters: Filters): {
  artist_id?: string;
  album_id?: string;
  genre?: string;
} {
  return {
    ...(filters.artist && { artist_id: filters.artist }),
    ...(filters.album && { album_id: filters.album }),
    ...(filters.genre && { genre: filters.genre }),
  };
}

/** `id` of a list played from, told apart by its filters: its play button shows playing only
 * while the queue holds that list. */
export function filteredId(id: string, filters: Filters): string {
  const set = Object.entries(filters).filter((entry): entry is [Facet, string] =>
    Boolean(entry[1]),
  );
  return set.length ? `${id}?${new URLSearchParams(set).toString()}` : id;
}

const PATHS = {
  artist: "/api/v1/filters/artists",
  album: "/api/v1/filters/albums",
  genre: "/api/v1/filters/genres",
} as const;

/** Choices shown at once; more are found by typing. */
export const OPTIONS = 50;

/** The choices of the `facet` filter on the `scope` list, the other filters set, matching
 * `q`; and what it is set to, named. */
export const filterOptionsQuery = (facet: Facet, scope: FilterScope, filters: Filters, q: string) =>
  queryOptions({
    queryKey: ["filters", facet, scope, filters, q],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET(PATHS[facet], {
          params: {
            query: { scope, ...filterParams(filters), ...(q && { q }), limit: OPTIONS },
          },
          signal,
        }),
      ),
    // Likes change from other devices, the library with each scan: looked at again soon.
    staleTime: 30_000,
  });
