import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { url } from "../test/api";
import {
  KITE,
  VARIOUS,
  WIND,
  album,
  mockFilterOptions,
  option,
  page,
  track,
} from "../test/catalog";
import { mockLikes } from "../test/me";
import { server } from "../test/server";
import { filteredId, filtersFrom, NO_FILTERS } from "./filters";

const QUIET = album("Тихие города", WIND, { genre: "Ambient" });
const SUMMER = album("Лето 2024", VARIOUS, { genre: "Pop" });
const TRACKS = [
  track("Шум", QUIET),
  track("Sunburn", SUMMER, [KITE]),
  track("Ночь", QUIET, [WIND, KITE]),
];

/** The tracks list as the server filters it; the query strings asked for. */
function mockTracks() {
  const asked: string[] = [];
  server.use(
    http.get(url("/api/v1/tracks"), ({ request }) => {
      const query = new URL(request.url).searchParams;
      asked.push(query.toString());
      const artist = query.get("artist_id");
      const albumId = query.get("album_id");
      const found = TRACKS.filter(
        (t) =>
          (!artist || t.artists.some((a) => a.id === artist)) &&
          (!albumId || t.album.id === albumId) &&
          !query.get("genre"),
      );
      return HttpResponse.json(page(found));
    }),
  );
  return asked;
}

const CHOICES = {
  artist: [option(KITE.id, KITE.name, 2), option(WIND.id, WIND.name, 2)],
  album: [option(SUMMER.id, SUMMER.title, 1, "Various Artists"), option(QUIET.id, QUIET.title, 2)],
  genre: [option("Ambient", "Ambient", 2), option("Pop", "Pop", 1)],
};

/** The titles of the rows of the tracks table. */
function rows(): string[] {
  const table = screen.getByRole("table", { name: "Tracks" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => TRACKS.find((t) => row.textContent?.includes(t.title))?.title ?? "");
}

function mockStreams() {
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
}

test("the tracks filtered by an artist found by typing, the filter named on its button", async () => {
  mockAccount();
  const asked = mockTracks();
  const choices = mockFilterOptions(CHOICES);
  const { user } = renderSignedIn("/tracks");
  await screen.findByRole("table", { name: "Tracks" });
  const filters = screen.getByRole("group", { name: "Filters" });

  await user.click(within(filters).getByRole("button", { name: "Artist" }));
  const list = await screen.findByRole("listbox", { name: "Artist" });
  await waitFor(() =>
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["All artists", "DJ Kite2", "Северный Ветер2"]),
  );
  expect(choices.artist.at(-1)).toBe("scope=tracks&limit=50");

  await user.type(screen.getByRole("combobox", { name: "Find: artist" }), "kite");
  await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
  expect(choices.artist.at(-1)).toBe("scope=tracks&q=kite&limit=50");
  await user.keyboard("{Enter}");

  const chip = await within(filters).findByRole("button", { name: "Artist: DJ Kite" });
  expect(chip).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await waitFor(() => expect(rows()).toEqual(["Sunburn", "Ночь"]));
  expect(asked.at(-1)).toBe(`sort=added&artist_id=${KITE.id}&limit=60&offset=0`);
  expect(screen.getByText("2 tracks")).toBeInTheDocument();

  // The other filters' choices are of what this one leaves.
  await user.click(within(filters).getByRole("button", { name: "Album" }));
  await screen.findByRole("listbox", { name: "Album" });
  expect(choices.album.at(-1)).toBe(`scope=tracks&artist_id=${KITE.id}&limit=50`);
  await user.click(await screen.findByRole("option", { name: /^Тихие города/ }));
  await waitFor(() => expect(rows()).toEqual(["Ночь"]));

  await user.click(within(filters).getByRole("button", { name: "Remove filter Artist: DJ Kite" }));
  await waitFor(() => expect(rows()).toEqual(["Шум", "Ночь"]));
  await user.click(within(filters).getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(rows()).toHaveLength(3));
});

test("the keyboard: arrows move through the choices, Enter picks, Escape closes", async () => {
  mockAccount();
  mockTracks();
  mockFilterOptions(CHOICES);
  const { user } = renderSignedIn("/tracks?genre=Ambient");
  const filters = await screen.findByRole("group", { name: "Filters" });
  const chip = await within(filters).findByRole("button", { name: "Genre: Ambient" });

  await user.click(chip);
  const field = await screen.findByRole("combobox", { name: "Find: genre" });
  expect(field).toHaveFocus();
  // On the current choice.
  await waitFor(() =>
    expect(screen.getByRole("option", { name: /^Ambient/ })).toHaveAttribute("data-active"),
  );
  expect(screen.getByRole("option", { name: /^Ambient/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{ArrowDown}");
  expect(field).toHaveAttribute(
    "aria-activedescendant",
    screen.getByRole("option", { name: /^Pop/ }).id,
  );
  await user.keyboard("{Enter}");
  expect(await within(filters).findByRole("button", { name: "Genre: Pop" })).toHaveFocus();

  await user.click(within(filters).getByRole("button", { name: "Genre: Pop" }));
  await screen.findByRole("listbox");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(within(filters).getByRole("button", { name: "Genre: Pop" })).toHaveFocus();

  // "All genres" takes the filter away.
  await user.click(within(filters).getByRole("button", { name: "Genre: Pop" }));
  await user.click(await screen.findByRole("option", { name: "All genres" }));
  expect(await within(filters).findByRole("button", { name: "Genre" })).toBeInTheDocument();
});

test("Enter typed before the search ran looks for it first, not picks from the old list", async () => {
  mockAccount();
  mockTracks();
  const choices = mockFilterOptions(CHOICES);
  const { user } = renderSignedIn("/tracks");
  const filters = await screen.findByRole("group", { name: "Filters" });
  await user.click(within(filters).getByRole("button", { name: "Artist" }));
  await screen.findByRole("option", { name: /^DJ Kite/ });

  await user.type(screen.getByRole("combobox", { name: "Find: artist" }), "ветер{Enter}");
  // Still choosing: nothing was picked from the list before the search.
  expect(screen.getByRole("listbox", { name: "Artist" })).toBeInTheDocument();
  const list = screen.getByRole("listbox", { name: "Artist" });
  await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(1));
  expect(choices.artist.at(-1)).toContain("q=");
  await user.keyboard("{Enter}");
  expect(
    await within(filters).findByRole("button", { name: "Artist: Северный Ветер" }),
  ).toBeInTheDocument();
});

test("a list the filters leave empty says so, and clears them", async () => {
  mockAccount();
  mockTracks();
  mockFilterOptions(CHOICES);
  const { user } = renderSignedIn("/tracks?genre=Pop");
  expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();
  const [, inEmptyState] = screen.getAllByRole("button", { name: "Clear filters" });
  await user.click(inEmptyState!);
  expect(await screen.findByRole("table", { name: "Tracks" })).toBeInTheDocument();
  expect(screen.queryByText("Nothing matches these filters")).not.toBeInTheDocument();
});

test("Liked songs plays what the filters leave", async () => {
  mockAccount();
  mockLikes({ tracks: TRACKS });
  mockFilterOptions(CHOICES);
  mockStreams();
  const { user, audio } = renderSignedIn(`/liked?artist=${WIND.id}`);
  const table = await screen.findByRole("table", { name: "Liked songs" });
  await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(3));
  expect(screen.getByText("2 tracks")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Play Liked songs" }));
  // Newest first.
  await waitFor(() => expect(audio.src).toContain(TRACKS[2]!.id));
  const next = within(screen.getByRole("complementary", { name: "Now playing" })).getByRole(
    "list",
    { name: "Up next" },
  );
  expect(
    within(next)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([expect.stringContaining("Шум")]);
  // Its button pauses them.
  expect(screen.queryByRole("button", { name: "Play Liked songs" })).not.toBeInTheDocument();

  // Other filters: another list, not the one playing.
  const filters = screen.getByRole("group", { name: "Filters" });
  await user.click(within(filters).getByRole("button", { name: /^Remove filter Artist/ }));
  await waitFor(() =>
    expect(
      within(screen.getByRole("table", { name: "Liked songs" })).getAllByRole("row"),
    ).toHaveLength(4),
  );
  expect(screen.getByRole("button", { name: "Play Liked songs" })).toBeInTheDocument();
});

test("Favourites: albums filtered by artist and genre; switching to artists keeps the genre", async () => {
  mockAccount();
  const likes = mockLikes({ albums: [QUIET, SUMMER] });
  void likes;
  const asked: string[] = [];
  server.events.on("request:start", ({ request }) => {
    const { pathname, search } = new URL(request.url);
    if (pathname.startsWith("/api/v1/me/likes/")) asked.push(pathname + search);
  });
  mockFilterOptions(CHOICES);
  const { user } = renderSignedIn(`/favorites?genre=pop&artist=${VARIOUS.id}`);
  const albums = await screen.findByRole("list", { name: "Albums" });
  expect(within(albums).getAllByRole("article")).toHaveLength(1);
  expect(asked).toContain(
    `/api/v1/me/likes/albums?artist_id=${VARIOUS.id}&genre=pop&limit=60&offset=0`,
  );

  await user.click(screen.getByRole("radio", { name: "Artists" }));
  const filters = screen.getByRole("group", { name: "Filters" });
  await waitFor(() =>
    expect(
      within(filters)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Genre: pop", "Remove filter Genre: pop", "Clear filters"]),
  );
  await waitFor(() =>
    expect(asked.at(-1)).toBe("/api/v1/me/likes/artists?genre=pop&limit=60&offset=0"),
  );
});

test("filters in the address, and the id of a list played filtered", () => {
  const params = new URLSearchParams("artist=a1&album=b2&genre=Rock&sort=title");
  expect(filtersFrom(params, ["artist", "genre"])).toEqual({
    artist: "a1",
    album: null,
    genre: "Rock",
  });
  expect(filteredId("added", NO_FILTERS)).toBe("added");
  expect(filteredId("liked", { artist: "a1", album: null, genre: "Hip Hop" })).toBe(
    "liked?artist=a1&genre=Hip+Hop",
  );
});
