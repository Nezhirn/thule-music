import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { url } from "../test/api";
import { WIND, album, page, track } from "../test/catalog";
import { server } from "../test/server";

// Counts the rows' renders: each row of the tracks page shows its artists.
const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock("./ArtistLinks", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ArtistLinks")>();
  return {
    ArtistLinks: (props: Parameters<typeof real.ArtistLinks>[0]) => {
      renders.count += 1;
      return real.ArtistLinks(props);
    },
  };
});

const QUIET = album("Тихие города", WIND);
const TRACKS = Array.from({ length: 50 }, (_, i) => track(`Song ${i + 1}`, QUIET, [WIND]));

test("a new track or a pause renders the rows it concerns, not every row", async () => {
  mockAccount();
  server.use(
    http.get(url("/api/v1/tracks"), () => HttpResponse.json(page(TRACKS))),
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
  const { user, audio } = renderSignedIn("/tracks");
  const table = await screen.findByRole("table", { name: "Tracks" });
  await user.click(within(table).getByRole("button", { name: "Play Song 1" }));
  await waitFor(() => expect(audio.src).toContain(TRACKS[0]!.id));
  act(() => audio.start(187));
  await waitFor(() =>
    expect(within(table).getByRole("row", { current: true })).toHaveTextContent("Song 1"),
  );

  renders.count = 0;
  await user.click(screen.getAllByRole("button", { name: "Next" })[0]!);
  await waitFor(() =>
    expect(within(table).getByRole("row", { current: true })).toHaveTextContent("Song 2"),
  );
  act(() => audio.start(187));
  act(() => audio.advance(5));
  // The two rows, and the player's own credits; not the fifty rows.
  expect(renders.count).toBeLessThan(15);
});
