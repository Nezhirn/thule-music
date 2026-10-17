// A small catalogue for tests of the catalogue pages.
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { url } from "./api";
import { server } from "./server";

type Album = Schemas["AlbumOut"];
type Track = Schemas["TrackOut"];
type ArtistRef = Schemas["ArtistRef"];

let next = 0;
const id = () => `00000000-0000-0000-0000-${String(++next).padStart(12, "0")}`;

export const WIND: ArtistRef = { id: id(), name: "Северный Ветер" };
export const ANNA: ArtistRef = { id: id(), name: "Анна Лунина" };
export const KITE: ArtistRef = { id: id(), name: "DJ Kite" };
export const VARIOUS: ArtistRef = { id: id(), name: "Various Artists" };

export const PALETTE: Schemas["CoverPalette"] = {
  average: "#203060",
  dominant: "#122047",
  muted: "#304060",
  vibrant: "#2050c0",
  luminance: 0.03,
};

export function album(title: string, artist: ArtistRef, extra: Partial<Album> = {}): Album {
  return {
    id: id(),
    title,
    year: 2021,
    genre: "Post-Rock",
    artist,
    cover_id: id(),
    cover_palette: PALETTE,
    added_at: "2026-01-01T00:00:00Z",
    liked: false,
    ...extra,
  };
}

export function track(
  title: string,
  on: Album,
  artists: ArtistRef[] = [on.artist],
  extra: Partial<Track> = {},
): Track {
  const [main = on.artist] = artists;
  return {
    id: id(),
    title,
    duration_ms: 187_000,
    track_no: 1,
    disc_no: null,
    codec: "flac",
    bitrate: 900,
    artist: main,
    artists,
    album: { id: on.id, title: on.title, cover_id: on.cover_id, cover_palette: on.cover_palette },
    album_artist: on.artist,
    cover_id: on.cover_id,
    cover_palette: on.cover_palette,
    liked: false,
    ...extra,
  };
}

export function albumDetail(on: Album, tracks: Track[]): Schemas["AlbumDetail"] {
  return {
    ...on,
    duration_ms: tracks.reduce((sum, t) => sum + t.duration_ms, 0),
    cover_custom: false,
    tracks,
  };
}

export function artistOut(artist: ArtistRef, extra: Partial<Schemas["ArtistOut"]> = {}) {
  return {
    ...artist,
    cover_id: null,
    cover_palette: null,
    album_count: 0,
    liked: false,
    ...extra,
  } satisfies Schemas["ArtistOut"];
}

export function page<T>(items: T[], total = items.length, offset = 0) {
  return { items, total, limit: 60, offset };
}

type FilterOption = Schemas["FilterOption"];

/** The filters' choices, served as the server would: those matching `q`, and the one each
 * is set to, named. Returns the query strings asked for, by facet. */
export function mockFilterOptions(choices: {
  artist?: FilterOption[];
  album?: FilterOption[];
  genre?: FilterOption[];
}) {
  const asked: Record<"artist" | "album" | "genre", string[]> = {
    artist: [],
    album: [],
    genre: [],
  };
  const own = { artist: "artist_id", album: "album_id", genre: "genre" } as const;
  for (const facet of ["artist", "album", "genre"] as const) {
    server.use(
      http.get(url(`/api/v1/filters/${facet}s`), ({ request }) => {
        const query = new URL(request.url).searchParams;
        asked[facet].push(query.toString());
        const q = (query.get("q") ?? "").toLowerCase();
        const items = (choices[facet] ?? []).filter((o) => o.name.toLowerCase().includes(q));
        const value = query.get(own[facet]);
        const selected = (choices[facet] ?? []).find((o) => o.value === value);
        return HttpResponse.json({
          items,
          total: items.length,
          selected: selected ? { value: selected.value, name: selected.name, detail: null } : null,
        });
      }),
    );
  }
  return asked;
}

export function option(value: string, name: string, count = 1, detail: string | null = null) {
  return { value, name, detail, count };
}
