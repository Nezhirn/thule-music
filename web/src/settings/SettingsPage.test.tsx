import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Schemas } from "../api/client";
import { REFRESH_TOKEN_KEY } from "../auth/tokens";
import { AVATAR_ID, mockAccount, PASSWORD, renderSignedIn } from "../test/account";
import { apiError, url } from "../test/api";
import { server } from "../test/server";
import { accentTokens, ambientColors, DEFAULT_ACCENT } from "../theme/theme";

const root = document.documentElement;
const accent = () => root.style.getPropertyValue("--accent");
const ambient = () => screen.getByTestId("backdrop").style.getPropertyValue("--ambient-1");

async function openSettings(options?: Parameters<typeof mockAccount>[0]) {
  const account = mockAccount(options);
  const view = renderSignedIn("/settings");
  await screen.findByRole("heading", { level: 1, name: "Settings" });
  return { ...account, ...view };
}

const ALBUM: Schemas["AlbumOut"] = {
  id: "00000000-0000-0000-0000-0000000000a1",
  title: "Blue Hour",
  year: 2024,
  genre: null,
  artist: { id: "00000000-0000-0000-0000-0000000000b1", name: "Nightingale" },
  cover_id: "00000000-0000-0000-0000-0000000000c1",
  cover_palette: {
    average: "#1f3a7a",
    dominant: "#1a2f6b",
    muted: "#3a4660",
    vibrant: "#2f6bff",
    luminance: 0.05,
  },
  added_at: "2026-01-01T00:00:00Z",
  liked: false,
};

describe("appearance", () => {
  test("an accent applies at once and is saved to the account", async () => {
    const { user, calls } = await openSettings();
    expect(accent()).toBe(DEFAULT_ACCENT);
    expect(screen.getByRole("radio", { name: "Violet" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Default colour" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Green" }));
    expect(screen.getByRole("radio", { name: "Green" })).toBeChecked();
    expect(accent()).toBe("#15803d");
    expect(calls).toContainEqual({
      method: "PATCH",
      path: "/api/v1/me/preferences",
      body: { accent_color: "#15803d" },
    });

    await user.click(screen.getByRole("button", { name: "Default colour" }));
    expect(accent()).toBe(DEFAULT_ACCENT);
    expect(calls.at(-1)?.body).toEqual({ accent_color: null });
  });

  test("a custom colour shows while it is picked and is saved once chosen", async () => {
    const { calls } = await openSettings();
    const picker = screen.getByLabelText("Custom colour");
    fireEvent.input(picker, { target: { value: "#ffd60a" } });
    expect(accent()).toBe("#ffd60a");
    expect(root.style.getPropertyValue("--accent-on")).toBe("#0d0e12"); // dark text on yellow
    expect(calls).toEqual([]);

    fireEvent.change(picker, { target: { value: "#ffd60a" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Default colour" })).toBeEnabled(),
    );
    expect(calls).toEqual([
      { method: "PATCH", path: "/api/v1/me/preferences", body: { accent_color: "#ffd60a" } },
    ]);
    const presets = within(screen.getByRole("radiogroup", { name: "Accent colour" }));
    expect(
      presets.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked),
    ).toEqual([]);
  });

  test("the account's accent and blur apply when the app starts", async () => {
    await openSettings({ preferences: { accent_color: "#1e3a8a", blur: false } });
    expect(accent()).toBe(accentTokens("#1e3a8a").accent);
    expect(root.style.getPropertyValue("--accent-text")).toBe(accentTokens("#1e3a8a").accentText);
    expect(root.dataset.blur).toBe("off");
    expect(screen.getByRole("switch", { name: "Frosted glass" })).not.toBeChecked();
  });

  test("blur can be switched off", async () => {
    const { user, calls } = await openSettings();
    expect(root.dataset.blur).toBe("on");
    await user.click(screen.getByRole("switch", { name: "Frosted glass" }));
    expect(root.dataset.blur).toBe("off");
    expect(calls.at(-1)?.body).toEqual({ blur: false });
  });

  test("a change the server refused is undone and explained", async () => {
    const { user } = await openSettings();
    server.use(http.patch(url("/api/v1/me/preferences"), () => apiError("http_error", 500)));
    const blur = screen.getByRole("switch", { name: "Frosted glass" });
    await user.click(blur);
    const card = screen.getByRole("region", { name: "Appearance" });
    expect(await within(card).findByRole("alert")).toHaveTextContent(
      "Couldn't save the change. Something went wrong on the server.",
    );
    expect(blur).toBeChecked();
    expect(root.dataset.blur).toBe("on");
  });

  test("the cover colours can be tried on an album before anything plays", async () => {
    server.use(
      http.get(url("/api/v1/albums"), () =>
        HttpResponse.json({
          items: [ALBUM, { ...ALBUM, id: "no-cover", cover_id: null }],
          total: 2,
          limit: 24,
          offset: 0,
        }),
      ),
    );
    const { user, calls } = await openSettings();
    const resting = ambient();
    expect(resting).toBe(ambientColors(DEFAULT_ACCENT, null)[0]);

    const group = await screen.findByRole("group", { name: "Try it on a cover" });
    const cover = within(group).getByRole("button", { name: "Blue Hour — Nightingale" });
    expect(within(group).getAllByRole("button")).toHaveLength(1); // albums without a cover aren't offered
    await user.click(cover);
    expect(cover).toHaveAttribute("aria-pressed", "true");
    expect(ambient()).toBe(ambientColors(DEFAULT_ACCENT, ALBUM.cover_palette)[0]);
    await user.click(cover);
    expect(ambient()).toBe(resting);

    // Without the cover colours there's nothing to try.
    await user.click(cover);
    await user.click(screen.getByRole("switch", { name: "Colours of the cover" }));
    expect(ambient()).toBe(resting);
    expect(screen.queryByRole("group", { name: "Try it on a cover" })).toBeNull();
    expect(calls.at(-1)?.body).toEqual({ adaptive_color: false });
  });

  test("a preview ends with the settings page", async () => {
    server.use(
      http.get(url("/api/v1/albums"), () =>
        HttpResponse.json({ items: [ALBUM], total: 1, limit: 24, offset: 0 }),
      ),
    );
    const { user } = await openSettings();
    await user.click(await screen.findByRole("button", { name: "Blue Hour — Nightingale" }));
    expect(ambient()).not.toBe(ambientColors(DEFAULT_ACCENT, null)[0]);
    await user.click(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Home" }),
    );
    expect(ambient()).toBe(ambientColors(DEFAULT_ACCENT, null)[0]);
  });
});

test("the streaming quality is saved", async () => {
  const { user, calls } = await openSettings();
  expect(screen.getByRole("radio", { name: "High" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "Data saver" }));
  expect(screen.getByRole("radio", { name: "Data saver" })).toBeChecked();
  expect(screen.getByText("Opus 96 kbps: for mobile data.")).toBeInTheDocument();
  expect(calls.at(-1)?.body).toEqual({ stream_quality: "low" });
});

describe("account", () => {
  test("the display name can be changed", async () => {
    const { user, calls } = await openSettings();
    const field = screen.getByLabelText(/Display name/);
    const save = screen.getByRole("button", { name: "Save" });
    expect(field).toHaveValue("Ada Lovelace");
    expect(save).toBeDisabled();

    await user.clear(field);
    await user.type(field, "  Ada King  ");
    await user.click(save);
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(field).toHaveValue("Ada King");
    expect(calls.at(-1)).toEqual({
      method: "PATCH",
      path: "/api/v1/auth/me",
      body: { display_name: "  Ada King  " },
    });
    expect(screen.getByRole("button", { name: "Account: Ada King" })).toBeInTheDocument();
  });

  test("a photo can be uploaded and removed", async () => {
    const { user, calls } = await openSettings();
    const photo = new File(["fake image"], "me.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Photo"), photo);
    expect(await screen.findByRole("button", { name: "Change photo" })).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ method: "PUT", path: "/api/v1/auth/me/avatar" });
    // (Under test the file reaches the mock server as a nameless blob.)
    expect((calls.at(-1)?.body as { file: Blob }).file.size).toBe(photo.size);
    const avatar = screen.getByRole("region", { name: "Account" }).querySelector("img");
    expect(avatar).toHaveAttribute("src", `/api/v1/covers/${AVATAR_ID}?size=300`);

    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(await screen.findByRole("button", { name: "Upload photo" })).toBeInTheDocument();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/api/v1/auth/me/avatar" });
  });

  test("a photo over the size limit isn't sent", async () => {
    const { user, calls } = await openSettings();
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.jpg", {
      type: "image/jpeg",
    });
    await user.upload(screen.getByLabelText("Photo"), huge);
    expect(screen.getByRole("alert")).toHaveTextContent("The photo is larger than 10 MB.");
    expect(calls).toEqual([]);
  });

  test("a photo the server can't read is explained", async () => {
    const { user } = await openSettings();
    server.use(http.put(url("/api/v1/auth/me/avatar"), () => apiError("not_an_image", 415)));
    await user.upload(
      screen.getByLabelText("Photo"),
      new File(["x"], "x.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file is not a supported image.",
    );
  });
});

describe("password", () => {
  const card = () => screen.getByRole("region", { name: "Password" });

  test("is checked before it is sent", async () => {
    const { user, calls } = await openSettings();
    await user.type(within(card()).getByLabelText("New password"), "short");
    await user.click(within(card()).getByRole("button", { name: "Change password" }));
    expect(within(card()).getAllByText("Fill in this field")).toHaveLength(2); // current, repeat
    expect(within(card()).getByText("At least 8 characters")).toBeInTheDocument();
    expect(within(card()).getByLabelText("Current password")).toHaveFocus();
    expect(calls).toEqual([]);
  });

  test("a wrong current password is pointed out", async () => {
    const { user } = await openSettings();
    await user.type(within(card()).getByLabelText("Current password"), "not-it");
    await user.type(within(card()).getByLabelText("New password"), "new-password");
    await user.type(within(card()).getByLabelText("Repeat new password"), "new-password");
    await user.click(within(card()).getByRole("button", { name: "Change password" }));
    expect(await within(card()).findByText("The current password is wrong.")).toBeInTheDocument();
    expect(within(card()).getByLabelText("Current password")).toHaveValue("");
    expect(within(card()).getByLabelText("Current password")).toHaveFocus();
  });

  test("a new password keeps this device signed in with fresh tokens", async () => {
    const { user, calls } = await openSettings();
    const before = localStorage.getItem(REFRESH_TOKEN_KEY);
    await user.type(within(card()).getByLabelText("Current password"), PASSWORD);
    await user.type(within(card()).getByLabelText("New password"), "new-password");
    await user.type(within(card()).getByLabelText("Repeat new password"), "new-password");
    await user.click(within(card()).getByRole("button", { name: "Change password" }));
    expect(await within(card()).findByRole("status")).toHaveTextContent(
      "Password changed. Your other devices were signed out.",
    );
    expect(calls.at(-1)).toEqual({
      method: "POST",
      path: "/api/v1/auth/me/password",
      body: { current_password: PASSWORD, new_password: "new-password" },
    });
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).not.toBe(before);
    expect(within(card()).getByLabelText("New password")).toHaveValue("");
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });
});
