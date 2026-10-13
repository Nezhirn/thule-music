import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn, type Call } from "../test/account";
import { apiError, url } from "../test/api";
import { album, albumDetail, artistOut, page, track, WIND } from "../test/catalog";
import { server } from "../test/server";
import { toastStore } from "../ui/toast";

type Track = Schemas["TrackOut"];

const QUIET = album("Тихие города", WIND, { year: 2021, genre: "Post-Rock" });
const SUMMER = album("Лето", WIND, { year: 2019 });
const DAWN = track("Рассвет", QUIET, [WIND], { track_no: 1 });
const DUSK = track("Закат", QUIET, [WIND], { track_no: 2 });
const OTHER_ID = "00000000-0000-0000-0000-0000000a1b0e";
const NEW = album("Новое", WIND);

const toast = () => toastStore.getState().message;

function setup({ role = "admin", path = `/albums/${QUIET.id}` } = {}) {
  mockAccount({ me: { role: role as "admin" | "user" } });
  const calls: Call[] = [];
  const state = { tracks: [DAWN, DUSK], album: QUIET, moved: [] as Track[] };
  const record = async (request: Request) => {
    const type = request.headers.get("content-type") ?? "";
    const body = type.includes("json")
      ? await request.clone().json()
      : type.includes("multipart")
        ? Object.fromEntries(await request.clone().formData())
        : null;
    const { pathname, search } = new URL(request.url);
    calls.push({ method: request.method, path: pathname + search, body });
  };
  server.use(
    http.get(url(`/api/v1/albums/${QUIET.id}`), () =>
      state.tracks.length
        ? HttpResponse.json(albumDetail(state.album, state.tracks))
        : apiError("album_not_found", 404),
    ),
    http.get(url(`/api/v1/albums/${SUMMER.id}`), () => HttpResponse.json(albumDetail(SUMMER, []))),
    http.get(url(`/api/v1/albums/${NEW.id}`), () => HttpResponse.json(albumDetail(NEW, []))),
    http.get(url(`/api/v1/artists/${WIND.id}`), () =>
      HttpResponse.json({
        ...artistOut(WIND, { album_count: 2 }),
        albums: [state.album, SUMMER],
        appears_on: [],
        top_tracks: state.tracks,
      }),
    ),
    http.get(url(`/api/v1/artists/${OTHER_ID}`), () =>
      HttpResponse.json({
        ...artistOut({ id: OTHER_ID, name: "Ветер" }),
        albums: [],
        appears_on: [],
        top_tracks: [],
      }),
    ),
    http.get(url("/api/v1/albums"), ({ request }) => {
      const q = new URL(request.url).searchParams.get("q") ?? "";
      return HttpResponse.json(page([QUIET, SUMMER].filter((a) => a.title.includes(q))));
    }),
    http.get(url("/api/v1/tracks/:id"), ({ params }) => {
      const found = [...state.tracks, ...state.moved].find((t) => t.id === params.id);
      return found ? HttpResponse.json(found) : apiError("track_not_found", 404);
    }),
    http.patch(url(`/api/v1/albums/${QUIET.id}`), async ({ request }) => {
      await record(request);
      const body = (await request.json()) as Schemas["AlbumPatch"];
      if (body.title === "Лето") return HttpResponse.json(SUMMER);
      state.album = { ...state.album, title: body.title ?? state.album.title };
      return HttpResponse.json(state.album);
    }),
    http.delete(url(`/api/v1/albums/${QUIET.id}`), async ({ request }) => {
      await record(request);
      const singles = new URL(request.url).searchParams.get("tracks") === "singles";
      state.tracks = [];
      return HttpResponse.json(singles ? [album("Рассвет", WIND), album("Закат", WIND)] : []);
    }),
    http.patch(url("/api/v1/tracks/:id"), async ({ request, params }) => {
      await record(request);
      const body = (await request.json()) as Schemas["TrackPatch"];
      const changed = {
        ...state.tracks.find((t) => t.id === params.id)!,
        title: body.title ?? "",
        artists: body.artists!.map((name, i) => (i === 0 ? WIND : { id: `a${i}`, name })),
      };
      state.tracks = state.tracks.map((t) => (t.id === params.id ? changed : t));
      return HttpResponse.json(changed);
    }),
    http.delete(url("/api/v1/tracks/:id"), async ({ request, params }) => {
      await record(request);
      state.tracks = state.tracks.filter((t) => t.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(url("/api/v1/tracks/move"), async ({ request }) => {
      await record(request);
      const body = (await request.json()) as Schemas["TrackMove"];
      const moving = state.tracks.filter((t) => body.track_ids.includes(t.id));
      state.moved.push(...moving.map((t) => ({ ...t, album: { ...t.album, id: SUMMER.id } })));
      state.tracks = state.tracks.filter((t) => !body.track_ids.includes(t.id));
      return HttpResponse.json(body.new_album ? NEW : SUMMER);
    }),
    http.patch(url(`/api/v1/artists/${WIND.id}`), async ({ request }) => {
      await record(request);
      const { name } = (await request.json()) as Schemas["ArtistPatch"];
      return HttpResponse.json(artistOut({ id: name === "Ветер" ? OTHER_ID : WIND.id, name }));
    }),
    http.post(url(`/api/v1/albums/${QUIET.id}/tracks`), async ({ request }) => {
      await record(request);
      // By content: jsdom's XMLHttpRequest sends files named "blob".
      const content = await ((await request.formData()).get("file") as File).text();
      if (content === "old") {
        return HttpResponse.json({ track: DAWN, duplicate: true }, { status: 201 });
      }
      const added = track("Утро", QUIET, [WIND], { track_no: 3 });
      state.tracks = [...state.tracks, added];
      return HttpResponse.json({ track: added, duplicate: false }, { status: 201 });
    }),
    http.get(url("/api/v1/tracks/:id/stream-url"), ({ params }) =>
      HttpResponse.json<Schemas["StreamUrl"]>({
        url: `/api/v1/tracks/${params.id as string}/stream?sig=x`,
        quality: "high",
        codec: "opus",
        bitrate: 160,
        expires_at: "2099-01-01T00:00:00Z",
      }),
    ),
  );
  const view = renderSignedIn(path);
  return { ...view, calls, state };
}

type User = ReturnType<typeof setup>["user"];

async function albumMenu(user: User, item: string, title = "Тихие города") {
  await user.click(await screen.findByRole("button", { name: `More for ${title}` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

async function trackMenu(user: User, title: string, item: string) {
  await user.click(await screen.findByRole("button", { name: `More for ${title}` }));
  await user.click(screen.getByRole("menuitem", { name: item }));
}

/** The titles up next in the queue. */
const upNext = () => {
  const panel = screen.getByRole("complementary", { name: "Now playing" });
  const list = within(panel).queryByRole("list", { name: "Up next" });
  return list
    ? within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    : [];
};

test("an album renamed; given another album's name, it is merged and that one shows", async () => {
  const { user, calls } = setup();
  await albumMenu(user, "Edit album");
  let dialog = await screen.findByRole("dialog", { name: "Edit album" });
  const title = within(dialog).getByRole("textbox", { name: "Title" });
  expect(title).toHaveValue("Тихие города");
  expect(within(dialog).getByRole("textbox", { name: "Album artist" })).toHaveValue(
    "Северный Ветер",
  );
  expect(within(dialog).getByRole("textbox", { name: /Year/ })).toHaveValue("2021");
  expect(within(dialog).getByRole("textbox", { name: /Genre/ })).toHaveValue("Post-Rock");

  await user.clear(within(dialog).getByRole("textbox", { name: /Year/ }));
  await user.type(within(dialog).getByRole("textbox", { name: /Year/ }), "21");
  expect(within(dialog).getByText("Four digits, like 2024")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  await user.type(within(dialog).getByRole("textbox", { name: /Year/ }), "22");
  await user.clear(title);
  await user.type(title, "Города");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(toast()).toBe("Saved Города"));
  expect(calls.at(-1)?.body).toEqual({
    title: "Города",
    artist: "Северный Ветер",
    year: 2122,
    genre: "Post-Rock",
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Города" })).toBeVisible();

  await albumMenu(user, "Edit album", "Города");
  dialog = await screen.findByRole("dialog", { name: "Edit album" });
  await user.clear(within(dialog).getByRole("textbox", { name: "Title" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "Лето");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(toast()).toBe("Merged into Лето"));
  expect(await screen.findByRole("heading", { level: 1, name: "Лето" })).toBeVisible();
});

test("a track's title and artists edited, one added and one taken away", async () => {
  const { user, calls } = setup();
  await trackMenu(user, "Рассвет", "Edit track");
  const dialog = await screen.findByRole("dialog", { name: "Edit track" });
  await user.clear(within(dialog).getByRole("textbox", { name: "Title" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "Рассвет (Live)");
  await user.click(within(dialog).getByRole("button", { name: "Add an artist" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Featured artist 1" }), "Анна");
  await user.click(within(dialog).getByRole("button", { name: "Add an artist" }));
  await user.click(within(dialog).getByRole("button", { name: "Remove the empty artist" }));
  await user.type(within(dialog).getByRole("textbox", { name: /Track number/ }), "x");
  expect(within(dialog).getByText("A number from 1 to 999")).toBeVisible();
  await user.clear(within(dialog).getByRole("textbox", { name: /Track number/ }));
  await user.type(within(dialog).getByRole("textbox", { name: /Track number/ }), "4");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(toast()).toBe("Saved Рассвет (Live)"));
  expect(calls.at(-1)).toEqual({
    method: "PATCH",
    path: `/api/v1/tracks/${DAWN.id}`,
    body: {
      title: "Рассвет (Live)",
      artists: ["Северный Ветер", "Анна"],
      track_no: 4,
      disc_no: null,
    },
  });
});

test("tracks moved into another album of the artist, or a new one", async () => {
  const { user, calls } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await albumMenu(user, "Move tracks");
  let dialog = await screen.findByRole("dialog", { name: "Move tracks" });
  const move = within(dialog).getByRole("button", { name: "Move" });
  expect(move).toBeDisabled();
  await user.click(within(dialog).getByRole("checkbox", { name: /Закат/ }));
  expect(within(dialog).getByRole("checkbox", { name: "All tracks" })).toBePartiallyChecked();
  // The artist's other albums, not this one.
  const albums = within(dialog).getByRole("radiogroup", { name: "Into album" });
  expect(await within(albums).findByRole("radio", { name: /Лето/ })).toBeVisible();
  expect(within(albums).queryByRole("radio", { name: /Тихие города/ })).toBeNull();
  await user.click(within(albums).getByRole("radio", { name: /Лето/ }));
  await user.click(move);

  await waitFor(() => expect(toast()).toBe("Moved 1 track to Лето"));
  expect(calls.at(-1)?.body).toEqual({ track_ids: [DUSK.id], album_id: SUMMER.id });
  // Gone from this album; still in the queue, from its new album.
  await waitFor(() => expect(screen.queryByRole("cell", { name: /Закат/ })).toBeNull());
  expect(upNext()).toEqual([expect.stringContaining("Закат")]);

  // The last one, into a new album: this album is no more, the new one shows.
  await albumMenu(user, "Move tracks");
  dialog = await screen.findByRole("dialog", { name: "Move tracks" });
  await user.click(within(dialog).getByRole("radio", { name: "A new album" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Album title" }), "Новое");
  expect(within(dialog).getByRole("textbox", { name: "Album artist" })).toHaveValue(
    "Северный Ветер",
  );
  await user.click(within(dialog).getByRole("button", { name: "Move" }));
  await waitFor(() => expect(toast()).toBe("Moved 1 track to Новое"));
  expect(calls.at(-1)?.body).toEqual({
    track_ids: [DAWN.id],
    new_album: { title: "Новое", artist: "Северный Ветер" },
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Новое" })).toBeVisible();
});

test("an album deleted into singles goes to its artist's page", async () => {
  const { user, calls } = setup();
  await albumMenu(user, "Delete album");
  const dialog = await screen.findByRole("dialog", { name: "Delete album" });
  expect(
    within(dialog).getByText("The files of its 2 tracks are deleted from the disk."),
  ).toBeVisible();
  const remove = within(dialog).getByRole("button", { name: "Delete" });
  expect(remove).toBeDisabled();
  await user.click(within(dialog).getByRole("radio", { name: /Keep the tracks as singles/ }));
  await user.click(remove);
  await waitFor(() => expect(toast()).toBe("The tracks of Тихие города are singles now"));
  expect(calls.at(-1)?.path).toBe(`/api/v1/albums/${QUIET.id}?tracks=singles`);
  expect(await screen.findByRole("heading", { level: 1, name: "Северный Ветер" })).toBeVisible();
});

test("an album deleted with its files; a track deleted leaves the queue", async () => {
  const { user, calls } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(upNext()).toEqual([expect.stringContaining("Закат")]));
  await trackMenu(user, "Закат", "Delete track");
  const confirm = await screen.findByRole("dialog", { name: "Delete track" });
  expect(confirm).toHaveAccessibleDescription("Закат — Северный Ветер");
  await user.click(within(confirm).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(toast()).toBe("Deleted Закат"));
  expect(upNext()).toEqual([]);
  expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: `/api/v1/tracks/${DUSK.id}` });

  await albumMenu(user, "Delete album");
  const dialog = await screen.findByRole("dialog", { name: "Delete album" });
  expect(within(dialog).getByText("The file of its track is deleted from the disk.")).toBeVisible();
  await user.click(within(dialog).getByRole("radio", { name: /Delete it with its tracks/ }));
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(toast()).toBe("Deleted Тихие города"));
  expect(calls.at(-1)?.path).toBe(`/api/v1/albums/${QUIET.id}?tracks=delete`);
  expect(await screen.findByRole("heading", { level: 1, name: "Albums" })).toBeVisible();
});

test("an artist renamed, and merged into another by that one's name", async () => {
  const { user, calls } = setup({ path: `/artists/${WIND.id}` });
  await user.click(await screen.findByRole("button", { name: "More for Северный Ветер" }));
  await user.click(screen.getByRole("menuitem", { name: "Rename artist" }));
  let dialog = await screen.findByRole("dialog", { name: "Rename artist" });
  const name = within(dialog).getByRole("textbox", { name: "Name" });
  await user.clear(name);
  await user.type(name, "Северный ветер");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(toast()).toBe("Renamed to Северный ветер"));
  expect(calls.at(-1)?.body).toEqual({ name: "Северный ветер" });

  await user.click(screen.getByRole("button", { name: "More for Северный Ветер" }));
  await user.click(screen.getByRole("menuitem", { name: "Rename artist" }));
  dialog = await screen.findByRole("dialog", { name: "Rename artist" });
  await user.clear(within(dialog).getByRole("textbox", { name: "Name" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Ветер");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(toast()).toBe("Merged into Ветер"));
  expect(await screen.findByRole("heading", { level: 1, name: "Ветер" })).toBeVisible();
});

test("files uploaded into an album, one by one", async () => {
  const { user, calls } = setup();
  await albumMenu(user, "Upload tracks");
  const dialog = await screen.findByRole("dialog", { name: "Upload into the album" });
  await user.upload(within(dialog).getByLabelText("Choose files"), [
    new File(["new"], "Утро.flac", { type: "audio/flac" }),
    new File(["old"], "old.mp3", { type: "audio/mpeg" }),
  ]);
  const list = within(dialog).getByRole("list", { name: "Upload into the album" });
  await waitFor(() => expect(within(list).getByText("Already in the library")).toBeVisible());
  expect(within(list).getByText("Утро")).toBeVisible();
  expect(within(list).getByText("Added")).toBeVisible();
  await waitFor(() => expect(toast()).toBe("Added 1 track"));
  expect(calls.map((call) => call.method)).toEqual(["POST", "POST"]);
  // The album shows it.
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(await screen.findByRole("cell", { name: /Утро/ })).toBeVisible();
});

test("listeners get no management items", async () => {
  const { user } = setup({ role: "user" });
  await user.click(await screen.findByRole("button", { name: "More for Рассвет" }));
  let menu = screen.getByRole("menu");
  for (const item of ["Edit track", "Move to another album", "Delete track"]) {
    expect(within(menu).queryByRole("menuitem", { name: item })).toBeNull();
  }
  expect(within(menu).queryByRole("separator")).toBeNull();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "More for Тихие города" }));
  menu = screen.getByRole("menu");
  for (const item of ["Edit album", "Upload tracks", "Move tracks", "Delete album"]) {
    expect(within(menu).queryByRole("menuitem", { name: item })).toBeNull();
  }
});
