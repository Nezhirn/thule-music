import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { mockAccount, renderSignedIn } from "../test/account";
import { apiError, url } from "../test/api";
import { server } from "../test/server";

const PLAYLIST: Schemas["PlaylistOut"] = {
  id: "00000000-0000-0000-0000-0000000000p1",
  name: "Road trip",
  description: null,
  track_count: 12,
  duration_ms: 2_700_000,
  cover_ids: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const sidebar = () => screen.getByRole("navigation", { name: "Main" });

test("the sidebar leads to every section and marks the current one", async () => {
  mockAccount();
  const { user } = renderSignedIn("/");
  await screen.findByRole("heading", { level: 1, name: /Ada Lovelace/ });
  expect(within(sidebar()).getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(document.title).toBe("Home — Thule");

  await user.click(within(sidebar()).getByRole("link", { name: "Albums" }));
  expect(screen.getByRole("heading", { level: 1, name: "Albums" })).toBeInTheDocument();
  expect(within(sidebar()).getByRole("link", { name: "Albums" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(document.title).toBe("Albums — Thule");
  // Keyboard and screen reader users land on the new page.
  expect(screen.getByRole("main")).toHaveFocus();
});

test("the sidebar lists the user's playlists", async () => {
  mockAccount();
  server.use(
    http.get(url("/api/v1/playlists"), () => HttpResponse.json([PLAYLIST])),
    http.get(url(`/api/v1/playlists/${PLAYLIST.id}`), () =>
      HttpResponse.json({ ...PLAYLIST, items: [] }),
    ),
  );
  const { user } = renderSignedIn("/");
  await screen.findByRole("navigation", { name: "Main" });
  const link = await within(sidebar()).findByRole("link", { name: "Road trip" });
  await user.click(link);
  expect(await screen.findByRole("heading", { level: 1, name: "Road trip" })).toBeInTheDocument();
  expect(link).toHaveAttribute("aria-current", "page");
});

test("the sidebar says when there are no playlists, or they didn't load", async () => {
  mockAccount();
  const { unmount } = renderSignedIn("/");
  await screen.findByRole("navigation", { name: "Main" });
  expect(await within(sidebar()).findByText("No playlists yet.")).toBeInTheDocument();
  unmount();

  server.use(http.get(url("/api/v1/playlists"), () => apiError("http_error", 500)));
  renderSignedIn("/library");
  expect(await screen.findAllByText("Couldn't load the playlists.")).not.toHaveLength(0);
});

test("administration is offered to administrators only", async () => {
  mockAccount({ me: { role: "user" } });
  renderSignedIn("/admin");
  // A user who opens its address lands on the home page.
  expect(
    await screen.findByRole("heading", { level: 1, name: /Ada Lovelace/ }),
  ).toBeInTheDocument();
  expect(within(sidebar()).queryByRole("link", { name: "Administration" })).toBeNull();
});

test("the account menu works from the keyboard", async () => {
  mockAccount();
  const { user } = renderSignedIn("/");
  const button = await screen.findByRole("button", { name: "Account: Ada Lovelace" });
  button.focus();

  await user.keyboard("{ArrowDown}");
  const menu = screen.getByRole("menu");
  const items = within(menu).getAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["Settings", "Administration", "Sign out"]);
  expect(items[0]).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(items[2]).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(items[0]).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(button).toHaveFocus();
  expect(button).toHaveAttribute("aria-expanded", "false");

  await user.keyboard("{ArrowUp}");
  expect(
    within(screen.getByRole("menu")).getByRole("menuitem", { name: "Sign out" }),
  ).toHaveFocus();
  await user.click(screen.getByRole("heading", { level: 1 })); // a click elsewhere closes it
  expect(screen.queryByRole("menu")).toBeNull();

  await user.click(button);
  await user.click(screen.getByRole("menuitem", { name: "Settings" }));
  expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  expect(screen.queryByRole("menu")).toBeNull();
});
