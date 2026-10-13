import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn, type Call } from "../test/account";
import { url } from "../test/api";
import { album, artistOut, KITE, page, WIND } from "../test/catalog";
import { server } from "../test/server";
import { toastStore } from "../ui/toast";

type Album = Schemas["AlbumOut"];

const QUIET = album("Тихие города", WIND, { genre: "Post-Rock" });
const SUMMER = album("Лето", WIND, { genre: "Post-Rock", year: 2019 });
const FIELDS = album("Поля", KITE, { genre: "Ambient" });
const CHOSEN = "00000000-0000-0000-0000-0000000c0de1";

const toast = () => toastStore.getState().message;

function setup({ role = "admin", path = `/artists/${WIND.id}` } = {}) {
  mockAccount({ me: { role: role as "admin" | "user" } });
  const calls: Call[] = [];
  const state = {
    albums: [QUIET, SUMMER] as Album[],
    picture: null as string | null,
    genres: new Map<string, Album[]>([
      ["Post-Rock", [QUIET, SUMMER]],
      ["Ambient", [FIELDS]],
    ]),
  };
  const record = async (request: Request) => {
    const type = request.headers.get("content-type") ?? "";
    const body = type.includes("json")
      ? await request.clone().json()
      : type.includes("multipart")
        ? Object.fromEntries(await request.clone().formData())
        : null;
    const { pathname, search } = new URL(request.url);
    calls.push({ method: request.method, path: decodeURIComponent(pathname + search), body });
  };
  const wind = () =>
    artistOut(WIND, {
      album_count: state.albums.length,
      cover_id: state.picture ?? QUIET.cover_id,
    });
  const genreOf = (name: string | null) =>
    [...state.genres.keys()].find((key) => key.toLowerCase() === name?.toLowerCase());
  server.use(
    http.get(url(`/api/v1/artists/${WIND.id}`), () =>
      HttpResponse.json<Schemas["ArtistDetail"]>({
        ...wind(),
        cover_custom: state.picture !== null,
        albums: state.albums,
        appears_on: [],
        top_tracks: [],
      }),
    ),
    http.get(url(`/api/v1/artists/${KITE.id}`), () =>
      HttpResponse.json<Schemas["ArtistDetail"]>({
        ...artistOut(KITE, { album_count: 1 }),
        cover_custom: false,
        albums: [FIELDS],
        appears_on: [],
        top_tracks: [],
      }),
    ),
    http.get(url("/api/v1/artists"), ({ request }) => {
      const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
      const all = [artistOut(KITE, { album_count: 1 }), wind()];
      return HttpResponse.json(page(all.filter((a) => a.name.toLowerCase().includes(q))));
    }),
    http.put(url(`/api/v1/artists/${WIND.id}/cover`), async ({ request }) => {
      await record(request);
      state.picture = CHOSEN;
      return HttpResponse.json(wind());
    }),
    http.delete(url(`/api/v1/artists/${WIND.id}/cover`), async ({ request }) => {
      await record(request);
      state.picture = null;
      return HttpResponse.json(wind());
    }),
    http.post(url(`/api/v1/artists/${WIND.id}/tracks`), async ({ request }) => {
      await record(request);
      const fresh = album("Новый", WIND);
      state.albums = [...state.albums, fresh];
      const track: Schemas["TrackOut"] = {
        id: "00000000-0000-0000-0000-0000000f1e5d",
        title: "Утро",
        duration_ms: 1000,
        track_no: 1,
        disc_no: null,
        codec: "flac",
        bitrate: 900,
        artist: WIND,
        artists: [WIND],
        album: { id: fresh.id, title: fresh.title, cover_id: null, cover_palette: null },
        album_artist: WIND,
        cover_id: null,
        cover_palette: null,
        liked: false,
      };
      return HttpResponse.json({ track, duplicate: false }, { status: 201 });
    }),
    http.post(url("/api/v1/albums/move"), async ({ request }) => {
      await record(request);
      const body = (await request.json()) as Schemas["AlbumsMove"];
      state.albums = state.albums.filter((a) => !body.album_ids.includes(a.id));
      return HttpResponse.json(
        body.artist === KITE.name ? artistOut(KITE) : artistOut({ id: CHOSEN, name: body.artist }),
      );
    }),
    http.delete(url(`/api/v1/artists/${WIND.id}`), async ({ request }) => {
      await record(request);
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch(url(`/api/v1/artists/${WIND.id}`), async ({ request }) => {
      await record(request);
      return HttpResponse.json(artistOut(KITE));
    }),
    http.get(url("/api/v1/genres"), () =>
      HttpResponse.json(
        [...state.genres].map(([name, albums]) => ({ name, album_count: albums.length })),
      ),
    ),
    http.get(url("/api/v1/albums"), ({ request }) => {
      const genre = genreOf(new URL(request.url).searchParams.get("genre"));
      return HttpResponse.json(page(genre ? state.genres.get(genre)! : [QUIET, SUMMER, FIELDS]));
    }),
    http.patch(url("/api/v1/genres"), async ({ request }) => {
      await record(request);
      const from = genreOf(new URL(request.url).searchParams.get("genre"))!;
      const { name } = (await request.json()) as Schemas["GenrePatch"];
      const albums = state.genres.get(from)!;
      state.genres.delete(from);
      state.genres.set(name, albums);
      return HttpResponse.json({ name, album_count: albums.length });
    }),
    http.post(url("/api/v1/albums/genre"), async ({ request }) => {
      await record(request);
      const body = (await request.json()) as Schemas["AlbumsGenre"];
      for (const [name, albums] of state.genres) {
        state.genres.set(
          name,
          albums.filter((a) => !body.album_ids.includes(a.id)),
        );
      }
      const moved = [QUIET, SUMMER, FIELDS].filter((a) => body.album_ids.includes(a.id));
      state.genres.set(body.genre, [...(state.genres.get(body.genre) ?? []), ...moved]);
      return HttpResponse.json({
        name: body.genre,
        album_count: state.genres.get(body.genre)!.length,
      });
    }),
    http.delete(url("/api/v1/genres"), async ({ request }) => {
      await record(request);
      state.genres.delete(genreOf(new URL(request.url).searchParams.get("genre"))!);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const view = renderSignedIn(path);
  return { ...view, calls, state };
}

type User = ReturnType<typeof setup>["user"];

async function menu(user: User, of: string, item: string) {
  await user.click(await screen.findByRole("button", { name: `More for ${of}` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

async function findArtist(user: User, dialog: HTMLElement, typed: string, name: RegExp) {
  await user.type(within(dialog).getByRole("searchbox", { name: "Find an artist" }), typed);
  await user.click(await within(dialog).findByRole("radio", { name }));
}

test("an artist's picture chosen, then given up for the album cover", async () => {
  const { user, calls } = setup();
  await menu(user, "Северный Ветер", "Change picture");
  const dialog = await screen.findByRole("dialog", { name: "Artist picture" });
  expect(within(dialog).queryByRole("button", { name: "Show the album cover" })).toBeNull();
  await user.upload(
    within(dialog).getByLabelText("Choose an image"),
    new File(["png"], "me.png", { type: "image/png" }),
  );
  await waitFor(() => expect(toast()).toBe("Changed the cover of Северный Ветер"));
  expect(calls.at(-1)).toMatchObject({ method: "PUT", path: `/api/v1/artists/${WIND.id}/cover` });

  await user.click(within(dialog).getByRole("button", { name: "Show the album cover" }));
  await waitFor(() => expect(calls.at(-1)?.method).toBe("DELETE"));
  await waitFor(() =>
    expect(within(dialog).queryByRole("button", { name: "Show the album cover" })).toBeNull(),
  );
});

test("an album uploaded for an artist: its title first, then the files", async () => {
  const { user, calls } = setup();
  await menu(user, "Северный Ветер", "Upload an album");
  const dialog = await screen.findByRole("dialog", { name: "Upload an album" });
  const choose = within(dialog).getByRole("button", { name: "Choose files" });
  expect(choose).toBeDisabled();
  expect(within(dialog).getByText("Type the album's title first.")).toBeVisible();
  await user.type(within(dialog).getByRole("textbox", { name: "Album title" }), " Новый ");
  await user.type(within(dialog).getByRole("textbox", { name: /Year/ }), "20");
  expect(choose).toBeDisabled();
  await user.type(within(dialog).getByRole("textbox", { name: /Year/ }), "24");
  expect(choose).toBeEnabled();

  await user.upload(
    within(dialog).getByLabelText("Choose files"),
    new File(["new"], "Утро.flac", { type: "audio/flac" }),
  );
  await waitFor(() => expect(toast()).toBe("Added 1 track"));
  const list = within(dialog).getByRole("list", { name: "Upload into the album" });
  expect(within(list).getByText("Added · Новый")).toBeVisible();
  expect(calls.at(-1)).toMatchObject({
    method: "POST",
    path: `/api/v1/artists/${WIND.id}/tracks`,
    body: { album: "Новый", year: "2024" },
  });
  expect(calls.at(-1)?.body).not.toHaveProperty("genre");
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("link", { name: /Новый/ })).toBeVisible();
});

test("all of an artist's albums given to another: that one's page shows", async () => {
  const { user, calls } = setup();
  await menu(user, "Северный Ветер", "Move albums");
  const dialog = await screen.findByRole("dialog", { name: "Move albums" });
  const move = within(dialog).getByRole("button", { name: "Move" });
  await user.click(within(dialog).getByRole("checkbox", { name: "All albums" }));
  expect(within(dialog).getByRole("checkbox", { name: /Лето/ })).toBeChecked();
  expect(within(dialog).getByText("Type a name to find them.")).toBeVisible();
  expect(move).toBeDisabled();
  // Not the artist they are taken from.
  await user.type(within(dialog).getByRole("searchbox", { name: "Find an artist" }), "е");
  expect(await within(dialog).findByText("No artists found")).toBeVisible();
  await user.clear(within(dialog).getByRole("searchbox", { name: "Find an artist" }));
  await findArtist(user, dialog, "kite", /DJ Kite/);
  await user.click(move);

  await waitFor(() => expect(toast()).toBe("Moved 2 albums to DJ Kite"));
  expect(calls.at(-1)?.body).toEqual({ album_ids: [QUIET.id, SUMMER.id], artist: "DJ Kite" });
  expect(await screen.findByRole("heading", { level: 1, name: "DJ Kite" })).toBeVisible();
});

test("one album given to a new artist: the page stays", async () => {
  const { user, calls } = setup();
  await menu(user, "Северный Ветер", "Move albums");
  const dialog = await screen.findByRole("dialog", { name: "Move albums" });
  await user.click(within(dialog).getByRole("checkbox", { name: /Лето/ }));
  await user.click(within(dialog).getByRole("radio", { name: "A new artist" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Artist name" }), "Ветер Юга");
  await user.click(within(dialog).getByRole("button", { name: "Move" }));
  await waitFor(() => expect(toast()).toBe("Moved 1 album to Ветер Юга"));
  expect(calls.at(-1)?.body).toEqual({ album_ids: [SUMMER.id], artist: "Ветер Юга" });
  expect(screen.getByRole("heading", { level: 1, name: "Северный Ветер" })).toBeVisible();
});

test("an artist deleted with their music: the artists show", async () => {
  const { user, calls } = setup();
  await menu(user, "Северный Ветер", "Delete artist");
  const dialog = await screen.findByRole("dialog", { name: "Delete artist" });
  const remove = within(dialog).getByRole("button", { name: "Delete" });
  expect(remove).toBeDisabled();
  await user.click(within(dialog).getByRole("radio", { name: /Delete them with their music/ }));
  await user.click(remove);
  await waitFor(() => expect(toast()).toBe("Deleted Северный Ветер"));
  expect(calls.at(-1)).toEqual({
    method: "DELETE",
    path: `/api/v1/artists/${WIND.id}`,
    body: null,
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Artists" })).toBeVisible();
});

test("an artist's everything given to another one", async () => {
  const { user, calls } = setup();
  await menu(user, "Северный Ветер", "Delete artist");
  const dialog = await screen.findByRole("dialog", { name: "Delete artist" });
  await user.click(within(dialog).getByRole("radio", { name: /Give everything/ }));
  const give = within(dialog).getByRole("button", { name: "Give" });
  expect(give).toBeDisabled();
  // No new artist to give to: that would be a rename.
  expect(within(dialog).queryByRole("radio", { name: "A new artist" })).toBeNull();
  await findArtist(user, dialog, "Kite", /DJ Kite/);
  await user.click(give);
  await waitFor(() => expect(toast()).toBe("Merged into DJ Kite"));
  expect(calls.at(-1)).toMatchObject({ method: "PATCH", body: { name: "DJ Kite" } });
  expect(await screen.findByRole("heading", { level: 1, name: "DJ Kite" })).toBeVisible();
});

test("a genre renamed, an album moved to another genre, the genre taken off", async () => {
  const { user, calls } = setup({ path: "/albums?genre=post-rock" });
  await menu(user, "Post-Rock", "Rename genre");
  let dialog = await screen.findByRole("dialog", { name: "Rename genre" });
  expect(
    within(dialog).getByText(/The name changes in the tags of the tracks of its 2 albums/),
  ).toBeVisible();
  const name = within(dialog).getByRole("textbox", { name: "Name" });
  expect(name).toHaveValue("Post-Rock");
  await user.clear(name);
  await user.type(name, "Пост-рок");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(toast()).toBe("Renamed to Пост-рок"));
  expect(calls.at(-1)).toEqual({
    method: "PATCH",
    path: "/api/v1/genres?genre=Post-Rock",
    body: { name: "Пост-рок" },
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Пост-рок" })).toBeVisible();

  await menu(user, "Пост-рок", "Move albums");
  dialog = await screen.findByRole("dialog", { name: "Move albums" });
  await user.click(await within(dialog).findByRole("checkbox", { name: /Тихие города/ }));
  // Its own genre is not a choice.
  const genres = within(dialog).getByRole("radiogroup", { name: "Into genre" });
  expect(within(genres).getAllByRole("radio")).toHaveLength(1);
  await user.click(within(genres).getByRole("radio", { name: /Ambient/ }));
  await user.click(within(dialog).getByRole("button", { name: "Move" }));
  await waitFor(() => expect(toast()).toBe("Moved 1 album into Ambient"));
  expect(calls.at(-1)?.body).toEqual({ album_ids: [QUIET.id], genre: "Ambient" });

  await menu(user, "Пост-рок", "Delete genre");
  dialog = await screen.findByRole("dialog", { name: "Delete genre" });
  expect(
    within(dialog).getByText("The files of its album are deleted from the disk."),
  ).toBeVisible();
  await user.click(within(dialog).getByRole("radio", { name: /Keep the albums/ }));
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(toast()).toBe("Took Пост-рок off its albums"));
  expect(calls.at(-1)?.path).toBe("/api/v1/genres?genre=Пост-рок&albums=keep");
  expect(await screen.findByRole("heading", { level: 1, name: "Albums" })).toBeVisible();
});

test("listeners get no menu for an artist or a genre", async () => {
  setup({ role: "user" });
  expect(await screen.findByRole("heading", { level: 1, name: "Северный Ветер" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "More for Северный Ветер" })).toBeNull();
});

test("listeners get no genre menu", async () => {
  setup({ role: "user", path: "/albums?genre=Ambient" });
  expect(await screen.findByRole("link", { name: /Поля/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: "More for Ambient" })).toBeNull();
});
