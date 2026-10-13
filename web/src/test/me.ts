// A mock server for the user's own music: likes and favourites, as the app changes them.
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { apiError, url } from "./api";
import { server } from "./server";

type Track = Schemas["TrackOut"];
type Album = Schemas["AlbumOut"];
type Artist = Schemas["ArtistOut"];

/** Likes kept by the mock server, newest last; `refuse` makes the next changes fail. */
export function mockLikes({
  tracks = [],
  albums = [],
  artists = [],
}: { tracks?: Track[]; albums?: Album[]; artists?: Artist[] } = {}) {
  const state = {
    tracks: [...tracks],
    albums: [...albums],
    artists: [...artists],
    refuse: false,
    /** "PUT track <id>", "DELETE album <id>", … */
    calls: [] as string[],
  };
  // The things that can be liked, by id: the liked ones, and those the test adds.
  const known = new Map<string, Track | Album | Artist>();
  const pageOf = <T extends { liked: boolean }>(items: T[], request: Request) => {
    const query = new URL(request.url).searchParams;
    const limit = Number(query.get("limit") ?? 60);
    const offset = Number(query.get("offset") ?? 0);
    const newest = [...items].reverse().map((item) => ({ ...item, liked: true }));
    return HttpResponse.json({
      items: newest.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    });
  };
  const change = (kind: "tracks" | "albums" | "artists") => {
    const name = kind.slice(0, -1);
    return [
      http.put(url(`/api/v1/me/likes/${kind}/:id`), ({ params }) => {
        const id = params.id as string;
        state.calls.push(`PUT ${name} ${id}`);
        if (state.refuse) return apiError("http_error", 500);
        const item = known.get(id);
        const list = state[kind] as { id: string }[];
        if (item && !list.some((liked) => liked.id === id)) list.push(item);
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(url(`/api/v1/me/likes/${kind}/:id`), ({ params }) => {
        const id = params.id as string;
        state.calls.push(`DELETE ${name} ${id}`);
        if (state.refuse) return apiError("http_error", 500);
        const list = state[kind] as { id: string }[];
        const at = list.findIndex((liked) => liked.id === id);
        if (at !== -1) list.splice(at, 1);
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(url(`/api/v1/me/likes/${kind}`), ({ request }) =>
        pageOf(state[kind] as { liked: boolean }[], request),
      ),
    ];
  };
  server.use(...change("tracks"), ...change("albums"), ...change("artists"));
  for (const item of [...tracks, ...albums, ...artists]) known.set(item.id, item);
  return {
    state,
    /** Lets the server like these when asked. */
    know(...items: (Track | Album | Artist)[]) {
      for (const item of items) known.set(item.id, item);
    },
  };
}

type PlaylistDetail = Schemas["PlaylistDetail"];

/** Playlists kept by the mock server as the app changes them; `refuse` makes changes fail. */
export function mockPlaylists(
  initial: { name: string; description?: string; tracks?: Track[] }[] = [],
) {
  let made = 0;
  const newId = () => `00000000-0000-0000-0000-p${String(++made).padStart(11, "0")}`;
  const state = {
    playlists: [] as PlaylistDetail[],
    refuse: false,
    /** "POST /playlists", "POST /playlists/<id>/move {…}", … */
    calls: [] as string[],
  };
  const known = new Map<string, Track>();
  const items = (tracks: Track[]) =>
    tracks.map((track, position) => ({
      item_id: newId(),
      position,
      added_at: "2026-01-01T00:00:00Z",
      track,
    }));
  const summary = (playlist: PlaylistDetail): PlaylistDetail => {
    const covers = [
      ...new Set(playlist.items.map((item) => item.track.album.cover_id).filter(Boolean)),
    ] as string[];
    return {
      ...playlist,
      items: playlist.items.map((item, position) => ({ ...item, position })),
      track_count: playlist.items.length,
      duration_ms: playlist.items.reduce((sum, item) => sum + item.track.duration_ms, 0),
      cover_ids: covers.slice(0, 4),
    };
  };
  const create = (name: string, description: string | null, tracks: Track[]) => {
    const playlist = summary({
      id: newId(),
      name,
      description,
      track_count: 0,
      duration_ms: 0,
      cover_ids: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      items: items(tracks),
    });
    state.playlists.unshift(playlist);
    return playlist;
  };
  for (const { name, description = null, tracks = [] } of [...initial].reverse()) {
    create(name, description, tracks);
  }
  const find = (id: unknown) => state.playlists.find((playlist) => playlist.id === id);
  // Applies a change to a playlist, which comes first in the list as the last changed.
  const change = (id: string, edit: (playlist: PlaylistDetail) => PlaylistDetail) => {
    const playlist = find(id);
    if (!playlist) return apiError("playlist_not_found", 404);
    if (state.refuse) return apiError("http_error", 500);
    const changed = summary(edit(playlist));
    state.playlists = [changed, ...state.playlists.filter((other) => other.id !== id)];
    return HttpResponse.json(changed);
  };
  const record = async (request: Request) => {
    const body =
      request.method === "DELETE" ? "" : ` ${JSON.stringify(await request.clone().json())}`;
    const path = new URL(request.url).pathname.replace("/api/v1", "");
    state.calls.push(`${request.method} ${path}${body}`);
  };

  server.use(
    http.get(url("/api/v1/playlists"), () =>
      HttpResponse.json<Schemas["PlaylistOut"][]>(
        state.playlists.map((playlist) => {
          const listed: Partial<PlaylistDetail> = { ...playlist };
          delete listed.items;
          return listed as Schemas["PlaylistOut"];
        }),
      ),
    ),
    http.post(url("/api/v1/playlists"), async ({ request }) => {
      await record(request);
      if (state.refuse) return apiError("http_error", 500);
      const body = (await request.json()) as Schemas["PlaylistIn"];
      return HttpResponse.json(create(body.name, body.description ?? null, []), {
        status: 201,
      });
    }),
    http.get(url("/api/v1/playlists/:id"), ({ params }) => {
      const playlist = find(params.id);
      return playlist ? HttpResponse.json(playlist) : apiError("playlist_not_found", 404);
    }),
    http.patch(url("/api/v1/playlists/:id"), async ({ request, params }) => {
      await record(request);
      const body = (await request.json()) as Schemas["PlaylistPatch"];
      return change(params.id as string, (playlist) => ({
        ...playlist,
        name: body.name ?? playlist.name,
        description: body.description === undefined ? playlist.description : body.description,
      }));
    }),
    http.delete(url("/api/v1/playlists/:id"), async ({ request, params }) => {
      await record(request);
      if (state.refuse) return apiError("http_error", 500);
      state.playlists = state.playlists.filter((playlist) => playlist.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(url("/api/v1/playlists/:id/tracks"), async ({ request, params }) => {
      await record(request);
      const body = (await request.json()) as Schemas["AddTracksIn"];
      const added = body.track_ids.map((id) => known.get(id)!);
      return change(params.id as string, (playlist) => ({
        ...playlist,
        items: [...playlist.items, ...items(added)],
      }));
    }),
    http.delete(url("/api/v1/playlists/:id/tracks/:item"), async ({ request, params }) => {
      await record(request);
      return change(params.id as string, (playlist) => ({
        ...playlist,
        items: playlist.items.filter((item) => item.item_id !== params.item),
      }));
    }),
    http.post(url("/api/v1/playlists/:id/move"), async ({ request, params }) => {
      await record(request);
      const body = (await request.json()) as Schemas["MoveIn"];
      return change(params.id as string, (playlist) => {
        const moved = playlist.items.find((item) => item.item_id === body.item_id)!;
        const rest = playlist.items.filter((item) => item !== moved);
        rest.splice(body.position, 0, moved);
        return { ...playlist, items: rest };
      });
    }),
  );
  return {
    state,
    /** Tracks the server can add to playlists. */
    know(...tracks: Track[]) {
      for (const track of tracks) known.set(track.id, track);
    },
  };
}

/** Plays kept by the mock server, newest first, paged as the server pages them. */
export function mockHistory(plays: { track: Track; played_at: string }[]) {
  const state = {
    plays: plays.map((play, i) => ({ id: `play-${i}`, ...play })),
    cleared: false,
  };
  server.use(
    http.get(url("/api/v1/me/history"), ({ request }) => {
      const query = new URL(request.url).searchParams;
      const limit = Number(query.get("limit") ?? 50);
      const before = query.get("before");
      const start = before ? state.plays.findIndex((play) => play.id === before) + 1 : 0;
      const items = state.plays.slice(start, start + limit);
      const more = start + limit < state.plays.length;
      return HttpResponse.json<Schemas["History"]>({
        items,
        next: more ? items.at(-1)!.id : null,
      });
    }),
    http.delete(url("/api/v1/me/history"), () => {
      state.plays = [];
      state.cleared = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return state;
}
