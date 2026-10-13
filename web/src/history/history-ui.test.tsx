import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { url } from "../test/api";
import { WIND, album, track } from "../test/catalog";
import { mockHistory, mockLikes } from "../test/me";
import { server } from "../test/server";

const QUIET = album("Тихие города", WIND);
const [DAWN, NOON] = ["Рассвет", "Полдень"].map((title) => track(title, QUIET)) as [
  Schemas["TrackOut"],
  Schemas["TrackOut"],
];

function at(daysAgo: number, hour: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour).toISOString();
}

test("plays are listed under their days, and a row plays the history", async () => {
  mockAccount();
  mockLikes();
  const now = new Date();
  mockHistory([
    { track: NOON, played_at: new Date(now.getTime() - 1000).toISOString() },
    { track: DAWN, played_at: at(1, 12) },
    { track: NOON, played_at: at(1, 11) },
  ]);
  server.use(
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
  const { user, audio } = renderSignedIn("/history");
  const table = await screen.findByRole("table", { name: "History" });
  const groups = within(table)
    .getAllByRole("rowgroup")
    .slice(1)
    .map((group) =>
      within(group)
        .getAllByRole("row")
        .map((row) => row.textContent?.split("Северный")[0]),
    );
  expect(groups).toEqual([
    ["Today", "Полдень"],
    ["Yesterday", "Рассвет", "Полдень"],
  ]);

  // The same track twice: the second row plays the second.
  const rows = within(table).getAllByRole("row", { name: /Полдень/ });
  await user.click(within(rows[1]!).getByRole("button", { name: "Play Полдень" }));
  await waitFor(() => expect(audio.src).toContain(NOON.id));
  // The last row: nothing after it.
  const nowPlaying = screen.getByRole("complementary", { name: "Now playing" });
  expect(within(nowPlaying).getByText("Nothing else is queued.")).toBeInTheDocument();
});

test("the history is cleared after asking", async () => {
  mockAccount();
  const state = mockHistory([{ track: DAWN, played_at: at(0, 0) }]);
  server.use(
    http.get(url("/api/v1/home"), () =>
      HttpResponse.json({ recently_added: [], for_you: [], recently_played: [], new_releases: [] }),
    ),
  );
  const { user } = renderSignedIn("/history");
  await user.click(await screen.findByRole("button", { name: "Clear history" }));
  const dialog = screen.getByRole("dialog", { name: "Clear the history?" });
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(state.cleared).toBe(false);

  await user.click(screen.getByRole("button", { name: "Clear history" }));
  await user.click(
    within(screen.getByRole("dialog", { name: "Clear the history?" })).getByRole("button", {
      name: "Clear",
    }),
  );
  expect(await screen.findByText("Nothing played yet")).toBeInTheDocument();
  expect(state.cleared).toBe(true);
  expect(screen.getAllByRole("status").at(-1)).toHaveTextContent("The history is cleared");
  expect(screen.queryByRole("button", { name: "Clear history" })).not.toBeInTheDocument();
});
