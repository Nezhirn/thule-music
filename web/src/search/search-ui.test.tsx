import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { url } from "../test/api";
import { ANNA, WIND, album, artistOut, track } from "../test/catalog";
import { mockPlaylists } from "../test/me";
import { mockSearch } from "../test/search";
import { server } from "../test/server";

const QUIET = album("Тихие города", WIND);
const SUMMER = album("Лето", ANNA);
const DAWN = track("Рассвет", QUIET);
const NIGHT = track("Ночной экспресс", QUIET, [WIND, ANNA]);
const WARM = track("Тёплый ветер", SUMMER);

function mockStream() {
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

const field = () => screen.getByRole("searchbox", { name: "Search the library" });

/** What screen readers were told about the results. */
async function announced(text: string) {
  await waitFor(() =>
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toContain(text),
  );
}

test("searches once typing pauses: the top result, tracks, artists, albums, playlists", async () => {
  mockAccount();
  mockPlaylists([{ name: "Ветер в лицо" }, { name: "Other" }]);
  const search = mockSearch({
    artists: [artistOut(WIND), artistOut(ANNA)],
    albums: [QUIET, SUMMER],
    tracks: [DAWN, NIGHT, WARM],
  });
  server.use(
    http.get(url("/api/v1/genres"), () =>
      HttpResponse.json([{ name: "Post-Rock", album_count: 2 }]),
    ),
  );
  const { user } = renderSignedIn("/search");
  // Nothing typed: genres to browse.
  expect(await screen.findByRole("link", { name: "Post-Rock" })).toHaveAttribute(
    "href",
    "/albums?genre=Post-Rock",
  );

  await user.type(field(), "  ветер ");
  await announced("For “ветер”: 1 artist, 1 album, 3 tracks, 1 playlist");
  // Once, for the whole word.
  expect(search.calls).toEqual(["ветер"]);

  // The artist's own name beats their songs.
  const top = screen.getByRole("region", { name: "Top result" });
  expect(within(top).getByRole("link", { name: "Северный Ветер" })).toHaveAttribute(
    "href",
    `/artists/${WIND.id}`,
  );
  expect(within(top).getByText("Artist")).toBeInTheDocument();
  const tracks = screen.getByRole("table", { name: "Tracks" });
  // Found by their artist's name too.
  expect(
    within(tracks)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent),
  ).toEqual([
    expect.stringContaining("Рассвет"),
    expect.stringContaining("Ночной экспресс"),
    expect.stringContaining("Тёплый ветер"),
  ]);
  expect(
    within(screen.getByRole("region", { name: "Albums" })).getByRole("link", {
      name: "Тихие города",
    }),
  ).toBeInTheDocument();
  const playlists = screen.getByRole("region", { name: "Playlists" });
  expect(within(playlists).getByRole("link", { name: "Ветер в лицо" })).toBeInTheDocument();
  expect(within(playlists).queryByRole("link", { name: "Other" })).toBeNull();

  // Cleared: the genres again.
  await user.click(screen.getByRole("button", { name: "Clear the search" }));
  expect(field()).toHaveValue("");
  expect(field()).toHaveFocus();
  expect(await screen.findByRole("link", { name: "Post-Rock" })).toBeInTheDocument();
});

test("Enter searches at once; nothing found says so", async () => {
  mockAccount();
  mockSearch({ tracks: [DAWN] });
  const { user } = renderSignedIn("/search");
  await user.type(await screen.findByRole("searchbox"), "zzz{Enter}");
  await announced("Nothing found for “zzz”");
  // Said, and shown.
  expect(screen.getAllByText("Nothing found for “zzz”")).toHaveLength(2);
  expect(screen.getByText("Check the spelling, or try other words.")).toBeInTheDocument();
});

test("one kind shows all of it, page by page", async () => {
  mockAccount();
  const many = Array.from({ length: 52 }, (_, i) => track(`Ветер ${i + 1}`, QUIET));
  const search = mockSearch({ tracks: many, albums: [QUIET] });
  const { user } = renderSignedIn("/search?q=ветер");
  await screen.findByRole("region", { name: "Top result" });
  await user.click(screen.getByRole("radio", { name: "Tracks" }));
  const table = await screen.findByRole("table", { name: "Tracks" });
  await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(1 + 50));
  await announced("For “ветер”: 50 tracks");
  await user.click(screen.getByRole("button", { name: "Show more" }));
  await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(1 + 52));
  expect(search.calls).toEqual(["ветер", "ветер tracks 0", "ветер tracks 50"]);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();

  await user.click(screen.getByRole("radio", { name: "Artists" }));
  await announced("No artists for “ветер”");
  await user.click(screen.getByRole("radio", { name: "Albums" }));
  expect(
    within(await screen.findByRole("list", { name: "Albums" })).getByRole("link", {
      name: "Тихие города",
    }),
  ).toBeInTheDocument();
});

test("the top result and a found track play", async () => {
  mockAccount();
  mockStream();
  mockSearch({ albums: [QUIET], tracks: [DAWN, NIGHT] });
  const { user, audio } = renderSignedIn("/search?q=рассвет");
  const top = await screen.findByRole("region", { name: "Top result" });
  expect(within(top).getByText("Track")).toBeInTheDocument();
  await user.click(within(top).getByRole("button", { name: "Play Рассвет" }));
  await waitFor(() => expect(audio.src).toContain(DAWN.id));
  expect(within(top).getByRole("button", { name: "Pause" })).toBeInTheDocument();
});

test("/ goes to the search field from another page, Ctrl+K from the search page", async () => {
  mockAccount();
  mockSearch({});
  const { user } = renderSignedIn("/albums");
  await screen.findByRole("heading", { level: 1, name: "Albums" });
  await user.keyboard("/");
  expect(await screen.findByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
  await waitFor(() => expect(field()).toHaveFocus());
  // Typed into the field, "/" is a character.
  await user.keyboard("a/b");
  expect(field()).toHaveValue("a/b");
  await user.click(document.body);
  await user.keyboard("{Control>}k{/Control}");
  expect(field()).toHaveFocus();
});
