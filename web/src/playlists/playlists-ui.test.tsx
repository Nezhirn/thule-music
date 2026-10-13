import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { url } from "../test/api";
import { WIND, album, albumDetail, track } from "../test/catalog";
import { mockLikes, mockPlaylists } from "../test/me";
import { server } from "../test/server";

type Track = Schemas["TrackOut"];

const QUIET = album("Тихие города", WIND);
const TRACKS = ["Рассвет", "Полдень", "Закат"].map((title, i) =>
  track(title, QUIET, [WIND], { track_no: i + 1 }),
);
const [DAWN, NOON, DUSK] = TRACKS as [Track, Track, Track];

function setup(playlists: Parameters<typeof mockPlaylists>[0] = []) {
  mockAccount();
  mockLikes();
  const mock = mockPlaylists(playlists);
  mock.know(...TRACKS);
  server.use(
    http.get(url(`/api/v1/albums/${QUIET.id}`), () =>
      HttpResponse.json(albumDetail(QUIET, TRACKS)),
    ),
    http.get(url(`/api/v1/artists/${WIND.id}`), () => HttpResponse.json({ albums: [] })),
  );
  return mock;
}

const sidebar = () => screen.findByRole("navigation", { name: "Main" });
/** The messages at the bottom (pages saying they load are statuses too, before it). */
const status = () => screen.getAllByRole("status").at(-1)!;
const titles = () =>
  within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[1]!.textContent);

test("a playlist opens from the sidebar, with its tracks", async () => {
  setup([{ name: "В дорогу", description: "На север", tracks: [DUSK, DAWN] }]);
  const { user } = renderSignedIn("/");
  await user.click(await within(await sidebar()).findByRole("link", { name: "В дорогу" }));
  expect(await screen.findByRole("heading", { level: 1, name: "В дорогу" })).toBeInTheDocument();
  expect(screen.getByText("На север")).toBeInTheDocument();
  expect(screen.getByText("2 tracks, 6 min")).toBeInTheDocument();
  expect(titles()).toEqual([
    "ЗакатСеверный Ветер · Тихие города",
    "РассветСеверный Ветер · Тихие города",
  ]);
});

test("a new playlist is made from the sidebar and opens", async () => {
  const { state } = setup();
  const { user } = renderSignedIn("/");
  await user.click(await within(await sidebar()).findByRole("button", { name: "New playlist" }));
  const dialog = screen.getByRole("dialog", { name: "New playlist" });
  // A name is needed.
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription(
    "Fill in this field",
  );
  await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "  Вечер ");
  await user.type(within(dialog).getByRole("textbox", { name: /Description/ }), "Тихо");
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Вечер" })).toBeInTheDocument();
  expect(screen.getByText("This playlist is empty")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await within(await sidebar()).findByRole("link", { name: "Вечер" })).toBeInTheDocument();
  expect(state.calls).toEqual(['POST /playlists {"name":"Вечер","description":"Тихо"}']);
});

test("a track's menu adds it to a playlist, or to a new one", async () => {
  const { state } = setup([{ name: "В дорогу" }]);
  const { user } = renderSignedIn(`/albums/${QUIET.id}`);
  const more = await screen.findByRole("button", { name: "More for Полдень" });
  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Add to playlist" }));
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  expect(dialog).toHaveAccessibleDescription("Adding Полдень");
  await user.click(within(dialog).getByRole("button", { name: /^В дорогу/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // The focus is back where the menu was.
  expect(more).toHaveFocus();
  await waitFor(() => expect(status()).toHaveTextContent("Полдень is in В дорогу"));

  await user.click(more);
  await user.click(screen.getByRole("menuitem", { name: "Add to playlist" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "New playlist" }),
  );
  const form = screen.getByRole("dialog", { name: "New playlist" });
  await user.type(within(form).getByRole("textbox", { name: "Name" }), "Ночь");
  await user.click(within(form).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(status()).toHaveTextContent("Полдень is in Ночь"));
  const [night] = state.playlists;
  expect(night?.name).toBe("Ночь");
  expect(state.calls).toEqual([
    `POST /playlists/${state.playlists[1]!.id}/tracks {"track_ids":["${NOON.id}"]}`,
    'POST /playlists {"name":"Ночь","description":null}',
    `POST /playlists/${night!.id}/tracks {"track_ids":["${NOON.id}"]}`,
  ]);
});

test("an album's menu adds all of it", async () => {
  const { state } = setup([{ name: "В дорогу" }]);
  const { user } = renderSignedIn(`/albums/${QUIET.id}`);
  await user.click(await screen.findByRole("button", { name: "More for Тихие города" }));
  await user.click(screen.getByRole("menuitem", { name: "Add to playlist" }));
  await user.click(screen.getByRole("button", { name: /^В дорогу/ }));
  await waitFor(() => expect(status()).toHaveTextContent("Тихие города is in В дорогу"));
  expect(state.playlists[0]!.items.map((item) => item.track.title)).toEqual([
    "Рассвет",
    "Полдень",
    "Закат",
  ]);
});

test("tracks move up and down and leave the playlist from their menus", async () => {
  const { state } = setup([{ name: "В дорогу", tracks: TRACKS }]);
  const { id } = state.playlists[0]!;
  const { user } = renderSignedIn(`/playlists/${id}`);
  const short = () => titles().map((title) => title?.split("Северный")[0]);
  await screen.findByRole("table");

  await user.click(screen.getByRole("button", { name: "More for Рассвет" }));
  expect(screen.queryByRole("menuitem", { name: "Move up" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "Move down" }));
  // At once, before the server answers.
  expect(short()).toEqual(["Полдень", "Рассвет", "Закат"]);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "More for Рассвет" })).toHaveFocus(),
  );
  await waitFor(() => expect(state.calls).toHaveLength(1));
  expect(state.calls[0]).toBe(
    `POST /playlists/${id}/move {"item_id":"${state.playlists[0]!.items[1]!.item_id}","position":1}`,
  );

  await user.click(screen.getByRole("button", { name: "More for Рассвет" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove from this playlist" }));
  expect(short()).toEqual(["Полдень", "Закат"]);
  await waitFor(() => expect(status()).toHaveTextContent("Рассвет is no longer in В дорогу"));
  // The focus goes to the track that took its place.
  expect(screen.getByRole("button", { name: "More for Закат" })).toHaveFocus();
  expect(screen.getByText("2 tracks, 6 min")).toBeInTheDocument();
});

test("a dragged track lands where it is dropped", async () => {
  const { state } = setup([{ name: "В дорогу", tracks: TRACKS }]);
  const { id } = state.playlists[0]!;
  renderSignedIn(`/playlists/${id}`);
  await screen.findByRole("table");
  const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
  const dataTransfer = { setData() {}, setDragImage() {}, effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(rows[0]!, { dataTransfer });
  // Rows have no size in jsdom: the pointer counts as over their lower half. Over the second
  // row's, the first would go after it: the line shows above the third.
  fireEvent.dragOver(rows[1]!, { dataTransfer, clientY: 1 });
  expect(rows[2]).toHaveAttribute("data-drop", "before");
  fireEvent.drop(rows[1]!, { dataTransfer });
  await waitFor(() =>
    expect(titles().map((title) => title?.split("Северный")[0])).toEqual([
      "Полдень",
      "Рассвет",
      "Закат",
    ]),
  );
  await waitFor(() => expect(state.calls).toHaveLength(1));
  expect(state.calls[0]).toContain('"position":1');
});

test("a playlist is renamed and deleted", async () => {
  const { state } = setup([{ name: "В дорогу", tracks: [DAWN] }]);
  const { id } = state.playlists[0]!;
  const { user } = renderSignedIn(`/playlists/${id}`);
  await user.click(await screen.findByRole("button", { name: "More for В дорогу" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit details" }));
  const dialog = screen.getByRole("dialog", { name: "Edit details" });
  const name = within(dialog).getByRole("textbox", { name: "Name" });
  await user.clear(name);
  await user.type(name, "На юг");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("heading", { level: 1, name: "На юг" })).toBeInTheDocument();
  expect(await within(await sidebar()).findByRole("link", { name: "На юг" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "More for На юг" }));
  await user.click(screen.getByRole("menuitem", { name: "Delete playlist" }));
  const confirm = screen.getByRole("dialog", { name: "Delete На юг?" });
  await user.click(within(confirm).getByRole("button", { name: "Delete" }));
  expect(
    await screen.findByRole("heading", { level: 1, name: /Ada Lovelace/ }),
  ).toBeInTheDocument();
  expect(status()).toHaveTextContent("На юг is deleted");
  expect(await within(await sidebar()).findByText("No playlists yet.")).toBeInTheDocument();
  expect(state.calls).toEqual([
    `PATCH /playlists/${id} {"name":"На юг","description":null}`,
    `DELETE /playlists/${id}`,
  ]);
});

test("a change the server refuses is undone, and the user is told", async () => {
  const { state } = setup([{ name: "В дорогу", tracks: TRACKS }]);
  state.refuse = true;
  const { user } = renderSignedIn(`/playlists/${state.playlists[0]!.id}`);
  await user.click(await screen.findByRole("button", { name: "More for Закат" }));
  await user.click(screen.getByRole("menuitem", { name: "Remove from this playlist" }));
  await waitFor(() =>
    expect(status()).toHaveTextContent(
      "Couldn't change the playlist. Something went wrong on the server.",
    ),
  );
  await waitFor(() => expect(titles()).toHaveLength(3));
});
