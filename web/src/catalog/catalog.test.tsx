import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { mockAccount, renderSignedIn } from "../test/account";
import { apiError, url } from "../test/api";
import {
  ANNA,
  KITE,
  PALETTE,
  VARIOUS,
  WIND,
  album,
  albumDetail,
  artistOut,
  mockFilterOptions,
  option,
  page,
  track,
} from "../test/catalog";
import { server } from "../test/server";
import { coverTint } from "../theme/theme";
import { duration } from "./format";

const QUIET = album("Тихие города", WIND);
const OTHER = album("Old Songs", WIND, { year: 2015 });
const SUMMER = album("Лето 2024", VARIOUS, { genre: "Pop", cover_palette: null });

/** Paths and query strings of the catalogue requests, in order. */
function requests() {
  const seen: string[] = [];
  server.events.on("request:start", ({ request }) => {
    const { pathname, search } = new URL(request.url);
    if (/\/(albums|artists|tracks|home|genres)/.test(pathname)) seen.push(pathname + search);
  });
  return seen;
}

describe("home", () => {
  test("shows new albums, picks and genres", async () => {
    mockAccount();
    server.use(
      http.get(url("/api/v1/home"), () =>
        HttpResponse.json({
          recently_added: [QUIET],
          for_you: [OTHER],
          recently_played: [],
          new_releases: [QUIET, OTHER],
        }),
      ),
      http.get(url("/api/v1/genres"), () =>
        HttpResponse.json([{ name: "Post-Rock", album_count: 2 }]),
      ),
    );
    renderSignedIn("/");
    const added = await screen.findByRole("region", { name: "Recently added" });
    expect(within(added).getByRole("link", { name: "Тихие города" })).toHaveAttribute(
      "href",
      `/albums/${QUIET.id}`,
    );
    expect(within(added).getByRole("link", { name: "Северный Ветер" })).toHaveAttribute(
      "href",
      `/artists/${WIND.id}`,
    );
    const forYou = screen.getByRole("region", { name: "For you" });
    expect(within(forYou).getByRole("link", { name: "Old Songs" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recently played" })).not.toBeInTheDocument();
    const releases = screen.getByRole("region", { name: "New releases" });
    expect(within(releases).getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/albums?sort=year",
    );
    const genres = await screen.findByRole("navigation", { name: "Genres" });
    expect(within(genres).getByRole("link", { name: "Post-Rock" })).toHaveAttribute(
      "href",
      "/albums?genre=Post-Rock",
    );
  });

  test("says when the library is empty", async () => {
    mockAccount();
    renderSignedIn("/");
    expect(await screen.findByText("The library is empty")).toBeInTheDocument();
  });

  test("offers to try again when it doesn't load", async () => {
    mockAccount();
    server.use(http.get(url("/api/v1/home"), () => apiError("http_error", 500), { once: true }));
    const { user } = renderSignedIn("/");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("The library is empty")).toBeInTheDocument();
  });
});

describe("album", () => {
  test("lists the tracks by disc, with the artists each one features", async () => {
    mockAccount();
    const tracks = [
      track("Рассвет", QUIET, [WIND], { track_no: 1, disc_no: 1 }),
      track("Тихие города", QUIET, [WIND, ANNA], { track_no: 2, disc_no: 1 }),
      track("Дом", QUIET, [WIND], { track_no: 1, disc_no: 2, duration_ms: 3_725_000 }),
    ];
    server.use(
      http.get(url(`/api/v1/albums/${QUIET.id}`), () =>
        HttpResponse.json(albumDetail(QUIET, tracks)),
      ),
      http.get(url(`/api/v1/artists/${WIND.id}`), () =>
        HttpResponse.json({
          ...artistOut(WIND, { album_count: 2 }),
          albums: [QUIET, OTHER],
          appears_on: [],
          top_tracks: [],
        }),
      ),
    );
    renderSignedIn(`/albums/${QUIET.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Тихие города" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Тихие города — Thule");
    expect(screen.getByText("Album")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Post-Rock" })).toHaveAttribute(
      "href",
      "/albums?genre=Post-Rock",
    );
    expect(screen.getByText("3 tracks, 1 hr 8 min")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Тихие города" });
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((h) => h.textContent),
    ).toEqual(["Disc 1", "Disc 2"]);
    const [first, second, third] = within(table)
      .getAllByRole("row")
      .filter((row) => within(row).queryAllByRole("cell").length > 0);
    // The album's artist isn't repeated; a guest is credited, with the artist they join.
    expect(within(first!).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(second!)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual(["Северный Ветер", "Анна Лунина"]);
    expect(third).toHaveTextContent(duration(3_725_000));
    expect(third).toHaveTextContent("1:02:05");

    // The artist's other albums, not this one again.
    const more = await screen.findByRole("region", { name: "More by Северный Ветер" });
    expect(within(more).getAllByRole("article")).toHaveLength(1);
    expect(within(more).getByRole("link", { name: "Old Songs" })).toBeInTheDocument();
  });

  test("of various artists is a compilation, crediting each track", async () => {
    mockAccount();
    const tracks = [
      track("Sunburn", SUMMER, [KITE], { track_no: 1 }),
      track("Тёплый ветер", SUMMER, [ANNA], { track_no: 2 }),
    ];
    server.use(
      http.get(url(`/api/v1/albums/${SUMMER.id}`), () =>
        HttpResponse.json(albumDetail(SUMMER, tracks)),
      ),
    );
    renderSignedIn(`/albums/${SUMMER.id}`);
    await screen.findByRole("heading", { level: 1, name: "Лето 2024" });
    expect(screen.getByText("Compilation")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "DJ Kite" })).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Анна Лунина" })).toBeInTheDocument();
  });

  test("that is gone says so", async () => {
    mockAccount();
    server.use(http.get(url(`/api/v1/albums/${QUIET.id}`), () => apiError("album_not_found", 404)));
    renderSignedIn(`/albums/${QUIET.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Album not found." }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Album not found. — Thule");
  });

  test("tints the panel with the cover's colours while it is shown", async () => {
    mockAccount();
    server.use(
      http.get(url(`/api/v1/albums/${SUMMER.id}`), () =>
        HttpResponse.json(albumDetail({ ...SUMMER, cover_palette: PALETTE }, [])),
      ),
    );
    const { user } = renderSignedIn(`/albums/${SUMMER.id}`);
    await screen.findByRole("heading", { level: 1, name: "Лето 2024" });
    const panel = screen.getByRole("main").parentElement!;
    expect(panel.style.getPropertyValue("--page-tint")).toBe(coverTint(PALETTE));
    await user.click(screen.getByRole("link", { name: "Albums" }));
    await screen.findByRole("heading", { level: 1, name: "Albums" });
    expect(panel.style.getPropertyValue("--page-tint")).toBe("transparent");
  });
});

describe("artist", () => {
  test("shows popular tracks, albums and where the artist appears", async () => {
    mockAccount();
    const top = Array.from({ length: 7 }, (_, i) => track(`Song ${i + 1}`, QUIET, [ANNA, WIND]));
    server.use(
      http.get(url(`/api/v1/artists/${ANNA.id}`), () =>
        HttpResponse.json({
          ...artistOut(ANNA),
          albums: [],
          appears_on: [QUIET, SUMMER],
          top_tracks: top,
        }),
      ),
    );
    const { user } = renderSignedIn(`/artists/${ANNA.id}`);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Анна Лунина" }),
    ).toBeInTheDocument();
    const popular = screen.getByRole("table", { name: "Popular" });
    const rows = () => within(popular).getAllByRole("row").length - 1;
    expect(rows()).toBe(5);
    const more = screen.getByRole("button", { name: "Show more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(rows()).toBe(7);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    expect(screen.queryByRole("region", { name: "Albums" })).not.toBeInTheDocument();
    const appears = screen.getByRole("region", { name: "Appears on" });
    expect(within(appears).getAllByRole("article")).toHaveLength(2);
  });
});

describe("albums", () => {
  test("sort and filters go into the request; more pages load on demand", async () => {
    mockAccount();
    const seen = requests();
    const all = Array.from({ length: 61 }, (_, i) => album(`Album ${i + 1}`, WIND));
    server.use(
      http.get(url("/api/v1/albums"), ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get("offset"));
        return HttpResponse.json(page(all.slice(offset, offset + 60), all.length, offset));
      }),
      http.get(url("/api/v1/genres"), () =>
        HttpResponse.json([
          { name: "Rock", album_count: 40 },
          { name: "Jazz", album_count: 21 },
        ]),
      ),
      http.get(url("/api/v1/filters/genres"), ({ request }) =>
        HttpResponse.json({
          items: [
            { value: "Rock", name: "Rock", detail: null, count: 40 },
            { value: "Jazz", name: "Jazz", detail: null, count: 21 },
          ],
          total: 2,
          selected: new URL(request.url).searchParams.get("genre")
            ? { value: "Jazz", name: "Jazz", detail: null }
            : null,
        }),
      ),
    );
    const { user } = renderSignedIn("/albums");
    expect(await screen.findByText("61 albums")).toBeInTheDocument();
    expect(await screen.findAllByRole("article")).toHaveLength(60);

    await user.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(61));
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "Title");
    const filters = screen.getByRole("group", { name: "Filters" });
    await user.click(within(filters).getByRole("button", { name: "Genre" }));
    await user.click(await screen.findByRole("option", { name: /^Jazz/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Jazz" })).toBeInTheDocument();
    expect(await within(filters).findByRole("button", { name: "Genre: Jazz" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("title");
    await waitFor(() =>
      expect(seen.filter((r) => r.startsWith("/api/v1/albums"))).toEqual([
        "/api/v1/albums?sort=added&limit=60&offset=0",
        "/api/v1/albums?sort=added&limit=60&offset=60",
        "/api/v1/albums?sort=title&limit=60&offset=0",
        "/api/v1/albums?sort=title&genre=Jazz&limit=60&offset=0",
      ]),
    );
  });
});

test("a genre's actions are on its own page, not on some of its albums", async () => {
  mockAccount({ me: { role: "admin" } });
  server.use(
    http.get(url("/api/v1/albums"), () => HttpResponse.json(page([SUMMER]))),
    http.get(url("/api/v1/genres"), () => HttpResponse.json([{ name: "Pop", album_count: 5 }])),
  );
  mockFilterOptions({ artist: [option(VARIOUS.id, VARIOUS.name)] });
  const { user } = renderSignedIn("/albums?genre=pop");
  expect(await screen.findByRole("heading", { level: 1, name: "Pop" })).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "More for Pop" })).toBeInTheDocument();

  const filters = screen.getByRole("group", { name: "Filters" });
  await user.click(within(filters).getByRole("button", { name: "Artist" }));
  await user.click(await screen.findByRole("option", { name: /^Various Artists/ }));
  await within(filters).findByRole("button", { name: "Artist: Various Artists" });
  expect(screen.getByRole("heading", { level: 1, name: "Pop" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "More for Pop" })).not.toBeInTheDocument();
});

describe("tracks", () => {
  test("lists tracks with their albums, in the chosen order", async () => {
    mockAccount();
    const seen = requests();
    server.use(
      http.get(url("/api/v1/tracks"), () =>
        HttpResponse.json(page([track("Sunburn", SUMMER, [KITE])])),
      ),
    );
    const { user } = renderSignedIn("/tracks");
    const table = await screen.findByRole("table", { name: "Tracks" });
    expect(within(table).getByRole("link", { name: "Лето 2024" })).toHaveAttribute(
      "href",
      `/albums/${SUMMER.id}`,
    );
    expect(within(table).getByRole("link", { name: "DJ Kite" })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "Artist");
    await waitFor(() =>
      expect(seen.filter((r) => r.startsWith("/api/v1/tracks"))).toEqual([
        "/api/v1/tracks?sort=added&limit=60&offset=0",
        "/api/v1/tracks?sort=artist&limit=60&offset=0",
      ]),
    );
  });
});
