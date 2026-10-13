// A mock of GET /search over a small catalogue: case-insensitive substrings, albums and
// tracks by their artist's name too, pages of one kind.
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { url } from "./api";
import { server } from "./server";

export function mockSearch(catalog: {
  artists?: Schemas["ArtistOut"][];
  albums?: Schemas["AlbumOut"][];
  tracks?: Schemas["TrackOut"][];
}) {
  const { artists = [], albums = [], tracks = [] } = catalog;
  /** "q", or "q type offset" for a page of one kind. */
  const calls: string[] = [];
  server.use(
    http.get(url("/api/v1/search"), ({ request }) => {
      const params = new URL(request.url).searchParams;
      const q = params.get("q") ?? "";
      const type = params.get("type");
      const limit = Number(params.get("limit") ?? 10);
      const offset = Number(params.get("offset") ?? 0);
      calls.push(type ? `${q} ${type} ${offset}` : q);
      const has = (text: string) => text.toLowerCase().includes(q.toLowerCase());
      const page = <T>(kind: string, items: T[]) =>
        type === null || type === kind ? items.slice(offset, offset + limit) : [];
      return HttpResponse.json<Schemas["SearchOut"]>({
        artists: page(
          "artists",
          artists.filter((artist) => has(artist.name)),
        ),
        albums: page(
          "albums",
          albums.filter((album) => has(album.title) || has(album.artist.name)),
        ),
        tracks: page(
          "tracks",
          tracks.filter((track) => has(track.title) || has(track.artist.name)),
        ),
      });
    }),
  );
  return { calls };
}
