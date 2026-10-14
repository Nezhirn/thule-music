import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { url } from "../test/api";
import { ANNA, WIND, album, albumDetail, artistOut, track } from "../test/catalog";
import { mockLikes } from "../test/me";
import { server } from "../test/server";

const QUIET = album("Тихие города", WIND);
const TRACKS = [
  track("Рассвет", QUIET, [WIND], { track_no: 1 }),
  track("Полдень", QUIET, [WIND, ANNA], { track_no: 2 }),
];
const [DAWN, NOON] = TRACKS as [Schemas["TrackOut"], Schemas["TrackOut"]];
const ARTIST = artistOut(WIND, { album_count: 1 });

function setup(likes: Parameters<typeof mockLikes>[0] = {}) {
  mockAccount();
  const mock = mockLikes(likes);
  mock.know(QUIET, ARTIST, ...TRACKS);
  server.use(
    http.get(url(`/api/v1/albums/${QUIET.id}`), () =>
      HttpResponse.json(albumDetail(QUIET, TRACKS)),
    ),
    http.get(url(`/api/v1/artists/${WIND.id}`), () =>
      HttpResponse.json({ ...ARTIST, albums: [QUIET], appears_on: [], top_tracks: TRACKS }),
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
  );
  return mock;
}

const status = () => screen.getByRole("status");

test("a heart likes a track at once; Liked songs has it, and unliking takes it out", async () => {
  const { state } = setup();
  const { user } = renderSignedIn(`/albums/${QUIET.id}`);
  const heart = await screen.findByRole("button", { name: "Like Рассвет" });
  expect(heart).toHaveAttribute("aria-pressed", "false");
  await user.click(heart);
  expect(heart).toHaveAttribute("aria-pressed", "true");
  expect(status()).toHaveTextContent("Рассвет is in Liked songs");
  await waitFor(() => expect(state.calls).toEqual([`PUT track ${DAWN.id}`]));

  await user.click(screen.getAllByRole("link", { name: "Liked songs" })[0]!);
  const table = await screen.findByRole("table", { name: "Liked songs" });
  expect(screen.getByText("1 track")).toBeInTheDocument();
  const row = within(table).getByRole("row", { name: /Рассвет/ });
  await user.click(within(row).getByRole("button", { name: "Like Рассвет" }));
  expect(status()).toHaveTextContent("Рассвет is no longer in Liked songs");
  expect(await screen.findByText("No liked songs yet")).toBeInTheDocument();
  expect(state.calls).toEqual([`PUT track ${DAWN.id}`, `DELETE track ${DAWN.id}`]);
});

test("once saved, a like is the page's: one undone on another device shows when it loads", async () => {
  const { state } = setup();
  const { user, queryClient } = renderSignedIn(`/albums/${QUIET.id}`);
  const heart = await screen.findByRole("button", { name: "Like Рассвет" });
  await user.click(heart);
  await waitFor(() => expect(state.calls).toEqual([`PUT track ${DAWN.id}`]));
  expect(heart).toHaveAttribute("aria-pressed", "true");
  // Unliked on the phone meanwhile: the album page loads again and says so.
  await act(() => queryClient.invalidateQueries({ queryKey: ["album", QUIET.id] }));
  await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "false"));
});

test("the track's menu likes and unlikes it too", async () => {
  const { state } = setup({ tracks: [NOON] });
  const { user } = renderSignedIn(`/albums/${QUIET.id}`);
  await user.click(await screen.findByRole("button", { name: "More for Рассвет" }));
  await user.click(screen.getByRole("menuitem", { name: "Add to Liked songs" }));
  expect(screen.getByRole("button", { name: "Like Рассвет" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "More for Рассвет" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove from Liked songs" }));
  await waitFor(() =>
    expect(state.calls).toEqual([`PUT track ${DAWN.id}`, `DELETE track ${DAWN.id}`]),
  );
  expect(screen.getByRole("button", { name: "Like Рассвет" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

test("a like the server refuses is put back, and the user is told", async () => {
  const { state } = setup();
  state.refuse = true;
  const { user } = renderSignedIn(`/albums/${QUIET.id}`);
  const heart = await screen.findByRole("button", { name: "Like Полдень" });
  await user.click(heart);
  await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "false"));
  expect(status()).toHaveTextContent(
    "Couldn't save the change. Something went wrong on the server.",
  );
});

test("the star keeps albums and artists in Favourites", async () => {
  const { state } = setup();
  const { user } = renderSignedIn(`/albums/${QUIET.id}`);
  const star = await screen.findByRole("button", { name: "Favourite" });
  await user.click(star);
  expect(star).toHaveAttribute("aria-pressed", "true");
  expect(status()).toHaveTextContent("Тихие города is in Favourites");

  await user.click(screen.getAllByRole("link", { name: "Favourites" })[0]!);
  const albums = await screen.findByRole("list", { name: "Albums" });
  expect(within(albums).getByRole("link", { name: "Тихие города" })).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "Artists" }));
  expect(await screen.findByText("No favourite artists yet")).toBeInTheDocument();

  await user.click(screen.getByRole("radio", { name: "Albums" }));
  await user.click(
    within(await screen.findByRole("list", { name: "Albums" })).getByRole("link", {
      name: "Северный Ветер",
    }),
  );
  await user.click(await screen.findByRole("button", { name: "Favourite" }));
  expect(status()).toHaveTextContent("Северный Ветер is in Favourites");
  await waitFor(() =>
    expect(state.calls).toEqual([`PUT album ${QUIET.id}`, `PUT artist ${WIND.id}`]),
  );
});

test("the player's heart is the row's, and the queue kept on the device remembers it", async () => {
  setup();
  const { user, audio } = renderSignedIn(`/albums/${QUIET.id}`);
  await user.click(await screen.findByRole("button", { name: "Play Тихие города" }));
  await waitFor(() => expect(audio.src).toContain(DAWN.id));
  const bar = screen.getAllByRole("region", { name: "Player" })[0]!;
  await user.click(within(bar).getByRole("button", { name: "Like Рассвет" }));
  const row = screen.getByRole("row", { current: true });
  expect(within(row).getByRole("button", { name: "Like Рассвет" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const saved = JSON.parse(localStorage.getItem("thule.player")!) as {
    queue: { items: { track: Schemas["TrackOut"] }[] };
  };
  expect(saved.queue.items.map((item) => item.track.liked)).toEqual([true, false]);
});

test("Liked songs plays all of them, not only the ones shown", async () => {
  const many = Array.from({ length: 61 }, (_, i) => track(`Песня ${i + 1}`, QUIET));
  setup({ tracks: many });
  const { user, audio } = renderSignedIn("/liked");
  const table = await screen.findByRole("table", { name: "Liked songs" });
  expect(within(table).getAllByRole("row")).toHaveLength(61); // the header and 60
  await user.click(screen.getByRole("button", { name: "Play Liked songs" }));
  // Newest first.
  await waitFor(() => expect(audio.src).toContain(many[60]!.id));
  const next = within(screen.getByRole("complementary", { name: "Now playing" })).getByRole(
    "list",
    { name: "Up next" },
  );
  expect(within(next).getAllByRole("listitem")).toHaveLength(60);
});
