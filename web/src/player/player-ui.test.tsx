import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { url } from "../test/api";
import { ANNA, PALETTE, WIND, album, albumDetail, track } from "../test/catalog";
import { server } from "../test/server";
import { ambientColors, DEFAULT_ACCENT } from "../theme/theme";

const OTHER_PALETTE: Schemas["CoverPalette"] = { ...PALETTE, vibrant: "#c02050" };
const QUIET = album("Тихие города", WIND, { cover_palette: OTHER_PALETTE });
const TRACKS = [
  track("Рассвет", QUIET, [WIND], { track_no: 1 }),
  track("Полдень", QUIET, [WIND, ANNA], { track_no: 2 }),
  track("Закат", QUIET, [WIND], { track_no: 3 }),
];
const [DAWN, NOON, DUSK] = TRACKS as [(typeof TRACKS)[0], (typeof TRACKS)[0], (typeof TRACKS)[0]];

/** The album's page, playable: stream URLs and plays answered and recorded. */
function setup(preferences: Partial<Schemas["Preferences"]> = {}) {
  mockAccount({ preferences });
  const streams: string[] = [];
  const plays: Schemas["PlayIn"][] = [];
  server.use(
    http.get(url(`/api/v1/albums/${QUIET.id}`), () =>
      HttpResponse.json(albumDetail(QUIET, TRACKS)),
    ),
    http.get(url(`/api/v1/artists/${WIND.id}`), () => HttpResponse.json({ albums: [] })),
    http.get(url("/api/v1/tracks/:id/stream-url"), ({ params, request }) => {
      const quality = new URL(request.url).searchParams.get("quality") as Schemas["Quality"];
      streams.push(`${params.id as string} ${quality}`);
      return HttpResponse.json<Schemas["StreamUrl"]>({
        url: `/api/v1/tracks/${params.id as string}/stream?quality=${quality}&sig=x`,
        quality,
        codec: quality === "original" ? "flac" : "opus",
        bitrate: quality === "original" ? 900 : 160,
        expires_at: "2099-01-01T00:00:00Z",
      });
    }),
    http.post(url("/api/v1/me/plays"), async ({ request }) => {
      plays.push((await request.json()) as Schemas["PlayIn"]);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const view = renderSignedIn(`/albums/${QUIET.id}`);
  // The bar along the bottom (the phone's mini player is in the page too: no CSS here).
  const bar = () => screen.getAllByRole("region", { name: "Player" })[0]!;
  const nowPlaying = () => screen.getByRole("complementary", { name: "Now playing" });
  return { ...view, streams, plays, bar, nowPlaying };
}

test("the album's play button plays it, and the player shows what plays", async () => {
  const { user, audio, streams, bar, nowPlaying } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));

  await waitFor(() => expect(audio.src).toContain(`/tracks/${DAWN.id}/stream`));
  expect(streams).toEqual([`${DAWN.id} high`]);
  expect(audio.paused).toBe(false);
  expect(within(bar()).getByRole("link", { name: "Рассвет" })).toHaveAttribute(
    "href",
    `/albums/${QUIET.id}`,
  );
  expect(within(nowPlaying()).getByText("Opus · 160 kbps")).toBeInTheDocument();
  const next = within(nowPlaying()).getByRole("list", { name: "Up next" });
  expect(
    within(next)
      .getAllByRole("button", { name: /^(?!Remove)/ })
      .map((button) => button.getAttribute("aria-label")),
  ).toEqual(["Полдень, Северный Ветер, Анна Лунина", "Закат, Северный Ветер"]);

  // The album's button now pauses it; the row of the track shows it playing.
  const header = screen.getByRole("heading", { level: 1, name: "Тихие города" }).closest("header")!;
  await user.click(within(header).getByRole("button", { name: "Pause" }));
  expect(audio.paused).toBe(true);
  expect(within(bar()).getByRole("button", { name: "Play" })).toBeInTheDocument();
  const row = screen.getByRole("row", { current: true });
  expect(within(row).getByText("Рассвет")).toBeInTheDocument();
});

test("the play button shows that it waits for the stream", async () => {
  const { user, audio, bar } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(audio.src).not.toBe(""));
  const pause = within(bar()).getByRole("button", { name: "Pause" });
  expect(pause).toHaveAttribute("aria-busy", "true");
  act(() => audio.start(187));
  expect(pause).not.toHaveAttribute("aria-busy");
  act(() => audio.emit("waiting"));
  expect(pause).toHaveAttribute("aria-busy", "true");
  await user.click(pause);
  expect(within(bar()).getByRole("button", { name: "Play" })).not.toHaveAttribute("aria-busy");
});

test("a row plays from its track; the menu queues tracks", async () => {
  const { user, audio, nowPlaying } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Полдень" }));
  await waitFor(() => expect(audio.src).toContain(NOON.id));
  const upNext = () =>
    within(within(nowPlaying()).getByRole("list", { name: "Up next" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
  expect(upNext()).toEqual(["ЗакатСеверный Ветер"]);

  await user.click(screen.getByRole("button", { name: "More for Рассвет" }));
  await user.click(screen.getByRole("menuitem", { name: "Play next" }));
  expect(upNext()).toEqual(["РассветСеверный Ветер", "ЗакатСеверный Ветер"]);
  expect(screen.getByRole("status")).toHaveTextContent("Рассвет plays next");

  await user.click(screen.getByRole("button", { name: "More for Полдень" }));
  await user.click(screen.getByRole("menuitem", { name: "Add to queue" }));
  expect(upNext()).toHaveLength(3);

  await user.click(
    within(nowPlaying()).getByRole("button", { name: "Remove Закат from the queue" }),
  );
  expect(upNext()).toEqual(["РассветСеверный Ветер", "ПолденьСеверный Ветер, Анна Лунина"]);

  await user.click(within(nowPlaying()).getByRole("button", { name: "Clear" }));
  expect(within(nowPlaying()).getByText("Nothing else is queued.")).toBeInTheDocument();
});

test("controls: next, seek, shuffle, repeat, volume", async () => {
  const { user, audio, bar } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(audio.src).toContain(DAWN.id));
  act(() => audio.start(187));

  await user.click(within(bar()).getByRole("button", { name: "Next" }));
  await waitFor(() => expect(audio.src).toContain(NOON.id));
  act(() => audio.start(187));

  const position = within(bar()).getByRole("slider", { name: "Position" });
  fireEvent.change(position, { target: { value: "90" } });
  expect(audio.currentTime).toBe(90);
  expect(position).toHaveAttribute("aria-valuetext", "1:30 of 3:07");
  // A drag the browser cancels (a scroll on a phone) seeks where it got to, without the
  // change event.
  fireEvent.pointerDown(position);
  fireEvent.input(position, { target: { value: "120" } });
  expect(position).toHaveAttribute("aria-valuetext", "2:00 of 3:07");
  expect(audio.currentTime).toBe(90);
  fireEvent.pointerCancel(window);
  await waitFor(() => expect(audio.currentTime).toBe(120));
  // One held when the track changes isn't shown on the next one.
  fireEvent.input(position, { target: { value: "150" } });
  await user.click(within(bar()).getByRole("button", { name: "Next" }));
  await waitFor(() => expect(audio.src).toContain(DUSK.id));
  expect(position).toHaveAttribute("aria-valuetext", "0:00 of 3:07");
  act(() => audio.start(187));

  const shuffle = within(bar()).getByRole("button", { name: "Shuffle" });
  await user.click(shuffle);
  expect(shuffle).toHaveAttribute("aria-pressed", "true");

  await user.click(within(bar()).getByRole("button", { name: "Repeat: off" }));
  await user.click(within(bar()).getByRole("button", { name: "Repeat: all" }));
  expect(within(bar()).getByRole("button", { name: "Repeat: this track" })).toBeInTheDocument();

  fireEvent.change(within(bar()).getByRole("slider", { name: "Volume" }), {
    target: { value: "30" },
  });
  expect(audio.volume).toBe(0.3);
  await user.click(within(bar()).getByRole("button", { name: "Mute" }));
  expect(audio.muted).toBe(true);
  expect(within(bar()).getByRole("slider", { name: "Volume" })).toHaveAttribute(
    "aria-valuetext",
    "0%",
  );
});

test("the playing track's cover colours the backdrop", async () => {
  const { user, audio } = setup();
  const backdrop = await screen.findByTestId("backdrop");
  const [accentOnly] = ambientColors(DEFAULT_ACCENT, null);
  const [covered] = ambientColors(DEFAULT_ACCENT, OTHER_PALETTE);
  expect(backdrop.style.getPropertyValue("--ambient-1")).toBe(accentOnly);
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(audio.src).not.toBe(""));
  expect(backdrop.style.getPropertyValue("--ambient-1")).toBe(covered);
});

test("plays at the quality from the settings, and records a play after 30 seconds", async () => {
  const { user, audio, streams, plays } = setup({ stream_quality: "original" });
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(streams).toEqual([`${DAWN.id} original`]));
  act(() => {
    audio.start(187);
    audio.advance(29.75);
  });
  expect(plays).toEqual([]);
  act(() => audio.advance(30));
  await waitFor(() =>
    expect(plays).toEqual([
      { track_id: DAWN.id, listened_ms: 30_000, played_at: expect.any(String) as string },
    ]),
  );
});

test("space plays and pauses, unless a control has the focus", async () => {
  const { user, audio } = setup();
  const play = await screen.findByRole("button", { name: "Play Тихие города" });
  await user.click(play);
  await waitFor(() => expect(audio.paused).toBe(false));
  (document.activeElement as HTMLElement).blur();
  await user.keyboard(" ");
  expect(audio.paused).toBe(true);
  await user.keyboard(" ");
  expect(audio.paused).toBe(false);
  screen.getAllByRole("button", { name: "Next" })[0]!.focus();
  fireEvent.keyDown(document.activeElement!, { key: " " });
  expect(audio.paused).toBe(false);
});

test("the queue comes back after a reload, paused where it was", async () => {
  mockAccount();
  localStorage.setItem(
    "thule.player",
    JSON.stringify({
      v: 1,
      queue: { items: [{ key: "a", track: DUSK }], current: 0, unshuffled: null },
      source: { type: "album", id: QUIET.id },
      repeat: "one",
      position: 65,
    }),
  );
  renderSignedIn("/settings");
  const bar = (await screen.findAllByRole("region", { name: "Player" }))[0]!;
  expect(await within(bar).findByRole("link", { name: "Закат" })).toBeInTheDocument();
  expect(within(bar).getByRole("slider", { name: "Position" })).toHaveAttribute(
    "aria-valuetext",
    "1:05 of 3:07",
  );
  expect(within(bar).getByRole("button", { name: "Play" })).toBeInTheDocument();
  expect(within(bar).getByRole("button", { name: "Repeat: this track" })).toBeInTheDocument();
});

test("signing out stops the player and forgets the queue", async () => {
  const { user, audio, bar } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(audio.paused).toBe(false));
  const region = bar();
  expect(localStorage.getItem("thule.player")).not.toBeNull();
  await user.click(screen.getByRole("button", { name: /^Account/ }));
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  await screen.findByRole("button", { name: "Sign in" });
  expect(audio.paused).toBe(true);
  expect(localStorage.getItem("thule.player")).toBeNull();
  expect(region).not.toBeInTheDocument();
});

test("the phone's mini player opens the full player", async () => {
  const { user, audio } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(audio.src).not.toBe(""));
  await user.click(
    screen.getByRole("button", { name: /^Рассвет, Северный Ветер\. Open the player/ }),
  );
  const dialog = screen.getByRole("dialog", { name: "Now playing" });
  expect(within(dialog).getByRole("link", { name: "Рассвет" })).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Next" }));
  await waitFor(() => expect(audio.src).toContain(NOON.id));
  await user.click(within(dialog).getByRole("button", { name: "Close the player" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
