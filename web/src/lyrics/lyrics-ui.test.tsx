import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { apiError, url } from "../test/api";
import { WIND, album, albumDetail, track } from "../test/catalog";
import { asPhone } from "../test/media";
import { server } from "../test/server";

const QUIET = album("Тихие города", WIND);
const TRACKS = [
  track("Рассвет", QUIET, [WIND], { track_no: 1 }),
  track("Полдень", QUIET, [WIND], { track_no: 2 }),
  track("Закат", QUIET, [WIND], { track_no: 3 }),
];
const [DAWN, NOON] = TRACKS as [Schemas["TrackOut"], Schemas["TrackOut"]];

const lyrics = (trackId: string, extra: Partial<Schemas["LyricsOut"]>): Schemas["LyricsOut"] => ({
  track_id: trackId,
  source: "lrclib",
  instrumental: false,
  synced: false,
  lines: [],
  plain: null,
  ...extra,
});

function setup() {
  mockAccount();
  server.use(
    http.get(url(`/api/v1/albums/${QUIET.id}`), () =>
      HttpResponse.json(albumDetail(QUIET, TRACKS)),
    ),
    http.get(url("/api/v1/tracks/:id/stream-url"), ({ params }) =>
      HttpResponse.json<Schemas["StreamUrl"]>({
        url: `/api/v1/tracks/${params.id as string}/stream?sig=x`,
        quality: "high",
        codec: "opus",
        bitrate: 160,
        expires_at: "2099-01-01T00:00:00Z",
      }),
    ),
    http.get(url("/api/v1/tracks/:id/lyrics"), ({ params }) => {
      if (params.id === DAWN.id) {
        return HttpResponse.json(
          lyrics(DAWN.id, { plain: "Встаёт заря\nНад рекой\n\nИ день пришёл" }),
        );
      }
      if (params.id === NOON.id) return HttpResponse.json(lyrics(NOON.id, { instrumental: true }));
      return apiError("lyrics_not_found", 404);
    }),
  );
  const view = renderSignedIn(`/albums/${QUIET.id}`);
  const bar = () => screen.getAllByRole("region", { name: "Player" })[0]!;
  return { ...view, bar };
}

test("the player's button opens the playing track's lyrics, which follow the next track", async () => {
  const { user, audio, bar } = setup();
  await screen.findAllByRole("region", { name: "Player" });
  // Nothing plays: no lyrics to show.
  expect(within(bar()).getByRole("button", { name: "Lyrics" })).toBeDisabled();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(audio.src).toContain(DAWN.id));

  const button = within(bar()).getByRole("button", { name: "Lyrics" });
  expect(button).toHaveAttribute("aria-pressed", "false");
  await user.click(button);
  expect(await screen.findByRole("heading", { level: 1, name: "Рассвет" })).toBeInTheDocument();
  expect(button).toHaveAttribute("aria-pressed", "true");
  const words = screen.getByRole("region", { name: "Lyrics" });
  expect(await within(words).findByText("Встаёт заря")).toBeInTheDocument();
  expect(
    within(words)
      .getAllByRole("paragraph")
      .map((p) => p.textContent),
  ).toEqual(["Встаёт заряНад рекой", "И день пришёл", "From LRCLIB"]);
  expect(document.title).toContain("Lyrics: Рассвет");

  await user.click(within(bar()).getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Полдень" })).toBeInTheDocument();
  expect(await screen.findByText("Instrumental")).toBeInTheDocument();
  await user.click(within(bar()).getByRole("button", { name: "Next" }));
  expect(await screen.findByText("No lyrics for this track")).toBeInTheDocument();

  // Pressed again: back to the page it was opened from.
  await user.click(button);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Тихие города" }),
  ).toBeInTheDocument();
  expect(button).toHaveAttribute("aria-pressed", "false");
});

test("the phone's player shows the lyrics in place of the cover", async () => {
  asPhone();
  const { user, audio } = setup();
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(audio.src).toContain(DAWN.id));
  await user.click(screen.getByRole("button", { name: /Open the player/ }));
  const dialog = screen.getByRole("dialog", { name: "Now playing" });
  const toggle = within(dialog).getByRole("button", { name: "Lyrics" });
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  const words = within(dialog).getByRole("region", { name: "Lyrics" });
  expect(await within(words).findByText("И день пришёл")).toBeInTheDocument();
  await user.click(toggle);
  expect(within(dialog).queryByRole("region", { name: "Lyrics" })).toBeNull();
});
