import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn, type Call } from "../test/account";
import { apiError, url } from "../test/api";
import { album, albumDetail, PALETTE, track, WIND } from "../test/catalog";
import { server } from "../test/server";
import { toastStore } from "../ui/toast";

type Lyrics = Schemas["LyricsOut"];

const QUIET = album("Тихие города", WIND);
const DAWN = track("Рассвет", QUIET, [WIND], { track_no: 1 });
const DUSK = track("Закат", QUIET, [WIND], { track_no: 2 });
const NEW_COVER = "00000000-0000-0000-0000-0000000c0e01";
const OWN_COVER = "00000000-0000-0000-0000-0000000c0e02";

const toast = () => toastStore.getState().message;
const coverOf = (element: HTMLElement) => element.querySelector("img")?.getAttribute("src");

function setup({ role = "admin" }: { role?: "admin" | "user" } = {}) {
  mockAccount({ me: { role } });
  const calls: Call[] = [];
  const state: { lyrics: Lyrics | null; detail: Schemas["AlbumDetail"] } = {
    lyrics: lyrics("Встаёт заря\nНад рекой"),
    detail: albumDetail(QUIET, [DAWN, DUSK]),
  };
  const record = async (request: Request) => {
    const multipart = request.headers.get("content-type")?.includes("multipart");
    const body = multipart
      ? Object.fromEntries(await request.clone().formData())
      : request.method === "PUT"
        ? await request.clone().json()
        : null;
    calls.push({ method: request.method, path: new URL(request.url).pathname, body });
  };
  server.use(
    http.get(url(`/api/v1/albums/${QUIET.id}`), () => HttpResponse.json(state.detail)),
    http.get(url("/api/v1/artists/:id"), () => apiError("artist_not_found", 404)),
    http.get(url(`/api/v1/tracks/${DAWN.id}/lyrics`), () =>
      state.lyrics ? HttpResponse.json(state.lyrics) : apiError("lyrics_not_found", 404),
    ),
    http.put(url(`/api/v1/tracks/${DAWN.id}/lyrics`), async ({ request }) => {
      await record(request);
      const { text, instrumental } = (await request.json()) as Schemas["LyricsIn"];
      state.lyrics = instrumental
        ? { ...lyrics(null), instrumental: true }
        : text?.trim()
          ? lyrics(text)
          : null;
      return HttpResponse.json(state.lyrics);
    }),
    http.delete(url(`/api/v1/tracks/${DAWN.id}/lyrics`), async ({ request }) => {
      await record(request);
      state.lyrics = null;
      return new HttpResponse(null, { status: 202 });
    }),
    http.put(url(`/api/v1/albums/${QUIET.id}/cover`), async ({ request }) => {
      await record(request);
      const changed = { ...QUIET, cover_id: NEW_COVER };
      state.detail = { ...state.detail, cover_id: NEW_COVER, cover_custom: true };
      return HttpResponse.json(changed);
    }),
    http.delete(url(`/api/v1/albums/${QUIET.id}/cover`), async ({ request }) => {
      await record(request);
      state.detail = { ...state.detail, cover_id: QUIET.cover_id, cover_custom: false };
      return HttpResponse.json(QUIET);
    }),
    http.put(url(`/api/v1/tracks/${DAWN.id}/cover`), async ({ request }) => {
      await record(request);
      return HttpResponse.json({ ...DAWN, cover_id: OWN_COVER, cover_palette: PALETTE });
    }),
    http.delete(url(`/api/v1/tracks/${DAWN.id}/cover`), async ({ request }) => {
      await record(request);
      return HttpResponse.json(DAWN);
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
  const view = renderSignedIn(`/albums/${QUIET.id}`);
  return { ...view, calls, state };
}

function lyrics(plain: string | null): Lyrics {
  return {
    track_id: DAWN.id,
    source: "manual",
    instrumental: false,
    synced: false,
    lines: [],
    plain,
  };
}

async function openTrackMenu(user: ReturnType<typeof setup>["user"], title: string) {
  await user.click(await screen.findByRole("button", { name: `More for ${title}` }));
}

test("an admin writes a track's lyrics from its menu, and takes wrong ones away", async () => {
  const { user, calls } = setup();
  await openTrackMenu(user, "Рассвет");
  await user.click(screen.getByRole("menuitem", { name: "Edit lyrics" }));

  const dialog = await screen.findByRole("dialog", { name: "Lyrics" });
  expect(dialog).toHaveAccessibleDescription("Рассвет — Северный Ветер");
  const words = await within(dialog).findByRole("textbox", { name: "Words" });
  expect(words).toHaveValue("Встаёт заря\nНад рекой");
  await user.clear(words);
  await user.type(words, "Новые слова");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(dialog).not.toBeVisible());
  expect(calls.at(-1)).toEqual({
    method: "PUT",
    path: `/api/v1/tracks/${DAWN.id}/lyrics`,
    body: { text: "Новые слова", instrumental: false },
  });
  expect(toast()).toBe("Saved the lyrics of Рассвет");

  // Instrumental: no words to edit.
  await openTrackMenu(user, "Рассвет");
  await user.click(screen.getByRole("menuitem", { name: "Edit lyrics" }));
  const again = await screen.findByRole("dialog", { name: "Lyrics" });
  expect(await within(again).findByRole("textbox", { name: "Words" })).toHaveValue("Новые слова");
  await user.click(within(again).getByRole("switch", { name: "Instrumental" }));
  expect(within(again).getByRole("textbox", { name: "Words" })).toBeDisabled();
  await user.click(within(again).getByRole("button", { name: "Cancel" }));
  expect(calls).toHaveLength(1);

  // Empty: the track has no lyrics.
  await openTrackMenu(user, "Рассвет");
  await user.click(screen.getByRole("menuitem", { name: "Edit lyrics" }));
  const last = await screen.findByRole("dialog", { name: "Lyrics" });
  await user.clear(await within(last).findByRole("textbox", { name: "Words" }));
  await user.click(within(last).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(toast()).toBe("Рассвет has no lyrics now"));
  expect(calls.at(-1)?.body).toEqual({ text: "", instrumental: false });
});

test("lyrics given up are looked for again until the server finds them", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { user, calls, state } = setup();
  await openTrackMenu(user, "Рассвет");
  await user.click(screen.getByRole("menuitem", { name: "Edit lyrics" }));
  const dialog = await screen.findByRole("dialog", { name: "Lyrics" });
  await within(dialog).findByRole("textbox", { name: "Words" });
  const find = within(dialog).getByRole("button", { name: "Find automatically" });
  expect(find).toHaveAccessibleDescription(/looks for them as an import does/);
  await user.click(find);
  expect(await within(dialog).findByRole("button", { name: "Looking…" })).toBeDisabled();
  expect(calls.at(-1)).toMatchObject({ method: "DELETE" });

  // Not found on the first look; the worker finds them meanwhile.
  await vi.advanceTimersByTimeAsync(1000);
  state.lyrics = { ...lyrics("Из LRCLIB"), source: "lrclib" };
  await vi.advanceTimersByTimeAsync(1500);
  await waitFor(() => expect(toast()).toBe("Found the lyrics of Рассвет"));
  expect(dialog).not.toBeVisible();
});

test("an admin changes an album's cover and gives it up again; the queue shows it", async () => {
  const { user, calls } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  const bar = screen.getAllByRole("region", { name: "Player" })[0]!;
  await waitFor(() => expect(coverOf(bar)).toContain(QUIET.cover_id));

  await user.click(screen.getByRole("button", { name: "More for Тихие города" }));
  await user.click(screen.getByRole("menuitem", { name: "Change cover" }));
  const dialog = await screen.findByRole("dialog", { name: "Album cover" });
  expect(dialog).toHaveAccessibleDescription("Тихие города — Северный Ветер");
  expect(within(dialog).queryByRole("button", { name: "Take it from the files" })).toBeNull();

  const image = new File(["fake image"], "front.jpg", { type: "image/jpeg" });
  await user.upload(within(dialog).getByLabelText("Choose an image"), image);
  await waitFor(() => expect(toast()).toBe("Changed the cover of Тихие города"));
  expect(calls.at(-1)).toMatchObject({ method: "PUT", path: `/api/v1/albums/${QUIET.id}/cover` });
  expect((calls.at(-1)!.body as { file: Blob }).file).toMatchObject({
    size: 10,
    type: "image/jpeg",
  });
  expect(coverOf(dialog)).toContain(NEW_COVER);
  await waitFor(() => expect(coverOf(bar)).toContain(NEW_COVER));

  await user.click(within(dialog).getByRole("button", { name: "Take it from the files" }));
  await waitFor(() => expect(coverOf(dialog)).toContain(QUIET.cover_id));
  expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
  expect(within(dialog).queryByRole("button", { name: "Take it from the files" })).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Done" }));
  expect(dialog).not.toBeVisible();
});

test("a track gets a picture of its own; images that won't do are refused at once", async () => {
  const { user, calls } = setup();
  await openTrackMenu(user, "Рассвет");
  await user.click(screen.getByRole("menuitem", { name: "Change cover" }));
  const dialog = await screen.findByRole("dialog", { name: "Track cover" });
  const input = within(dialog).getByLabelText("Choose an image");

  const huge = new File(["x"], "huge.png", { type: "image/png" });
  Object.defineProperty(huge, "size", { value: 20 * 1024 * 1024 + 1 });
  await user.upload(input, huge);
  expect(within(dialog).getByRole("alert")).toHaveTextContent("The image is larger than 20 MB.");
  expect(calls).toEqual([]);

  await user.upload(input, new File(["x"], "front.png", { type: "image/png" }));
  await waitFor(() => expect(coverOf(dialog)).toContain(OWN_COVER));
  expect(within(dialog).queryByRole("alert")).toBeNull();
  expect(toast()).toBe("Changed the cover of Рассвет");

  await user.click(within(dialog).getByRole("button", { name: "Show the album cover" }));
  await waitFor(() => expect(coverOf(dialog)).toContain(QUIET.cover_id));
  expect(calls.map((call) => call.method)).toEqual(["PUT", "DELETE"]);
});

test("listeners get no edit items", async () => {
  const { user } = setup({ role: "user" });
  await openTrackMenu(user, "Рассвет");
  const menu = screen.getByRole("menu");
  expect(within(menu).getByRole("menuitem", { name: "Go to artist" })).toBeVisible();
  expect(within(menu).queryByRole("menuitem", { name: "Edit lyrics" })).toBeNull();
  expect(within(menu).queryByRole("menuitem", { name: "Change cover" })).toBeNull();
});
