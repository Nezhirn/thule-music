import { screen, waitFor, within } from "@testing-library/react";
import { mockAccount, renderSignedIn } from "../test/account";
import { failedJob, mockAdmin } from "../test/admin";
import { album, track, WIND } from "../test/catalog";
import { toastStore } from "../ui/toast";

const card = (name: string) => screen.getByRole("region", { name });
const toast = () => toastStore.getState().message;

test("the library's numbers, and a scan followed until its files are in", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockAccount();
  const admin = mockAdmin();
  const { user } = renderSignedIn("/admin");

  expect(await screen.findByRole("heading", { level: 1, name: "Administration" })).toBeVisible();
  expect(document.title).toBe("Library · Administration — Thule");
  const tabs = screen.getByRole("navigation", { name: "Administration sections" });
  expect(within(tabs).getByRole("link", { name: "Library" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const stats = await screen.findByRole("region", { name: "In the library" });
  await waitFor(() => expect(within(stats).getByText("43")).toBeVisible());
  expect(within(stats).getByText("tracks")).toBeVisible();
  expect(within(stats).getByText("13 MB")).toBeVisible();
  const scanning = card("Scanning");
  expect(await within(scanning).findByText("The library hasn't been scanned yet.")).toBeVisible();
  expect(within(card("Background work")).getByText("Nothing is waiting.")).toBeVisible();

  await user.click(within(scanning).getByRole("button", { name: "Scan the library" }));
  expect(admin.calls.map((call) => call.path)).toContain("/api/v1/library/scan");
  expect(await within(scanning).findByRole("status")).toHaveTextContent("Waiting for the worker…");
  expect(within(scanning).getByRole("button", { name: "Scanning…" })).toBeDisabled();

  admin.state.scan = { ...admin.state.scan!, status: "running" };
  admin.state.summary = { kinds: { scan_library: counts({ running: 1 }) }, pending: 1, failed: 0 };
  await vi.advanceTimersByTimeAsync(1000);
  await waitFor(() =>
    expect(within(scanning).getByRole("status")).toHaveTextContent(
      "Looking for changes in the music folder…",
    ),
  );
  expect(within(card("Background work")).getByText("Scanning")).toBeVisible();

  const result = { ...nothing, added: 3, removed: 1 };
  const imports = counts({ queued: 1, done: 2 });
  admin.state.scan = { ...admin.state.scan!, status: "done", result, finished_at: now(), imports };
  admin.state.summary = { kinds: { import_track: imports }, pending: 1, failed: 0 };
  await vi.advanceTimersByTimeAsync(1000);
  const progress = await within(scanning).findByRole("progressbar", { name: "Import" });
  expect(progress).toHaveAttribute("value", "2");
  expect(progress).toHaveAttribute("max", "3");
  expect(within(scanning).getByText("2 of 3")).toBeVisible();
  // Not over before its files are in.
  expect(toast()).toBeNull();

  admin.state.scan = { ...admin.state.scan, imports: counts({ done: 3 }) };
  admin.state.summary = { kinds: { import_track: counts({ done: 3 }) }, pending: 0, failed: 0 };
  await vi.advanceTimersByTimeAsync(1000);
  expect(await within(scanning).findByText("Last scan now")).toBeVisible();
  expect(
    within(scanning).getByText("3 added, 1 removed · 50 audio files in the folder"),
  ).toBeVisible();
  expect(within(scanning).getByRole("button", { name: "Scan the library" })).toBeEnabled();
  expect(toast()).toBe("The library is up to date: 3 added, 1 removed.");
});

test("tracks a scan couldn't find are kept until the admin removes them", async () => {
  mockAccount();
  const admin = mockAdmin();
  admin.state.scan = {
    id: "00000000-0000-0000-0000-00000000005b",
    status: "done",
    created_at: now(),
    finished_at: now(),
    error: null,
    result: { ...nothing, files: 0, missing: 1200, unreadable: 3 },
    imports: counts({}),
  };
  const { user } = renderSignedIn("/admin");
  const scanning = await screen.findByRole("region", { name: "Scanning" });
  expect(
    await within(scanning).findByText(
      /^1200 tracks weren't found in the music folder and were kept/,
    ),
  ).toBeVisible();
  expect(
    within(scanning).getByText(/^3 tracks are in folders that couldn't be read and were kept/),
  ).toBeVisible();

  await user.click(within(scanning).getByRole("button", { name: "Remove from the library" }));
  await waitFor(() =>
    expect(admin.calls).toContainEqual({
      method: "POST",
      path: "/api/v1/library/scan",
      body: { remove_missing: true },
    }),
  );
  // The scan that removes them is on its way; the warning goes with the scan it was about.
  expect(await within(scanning).findByText("Waiting for the worker…")).toBeVisible();
  expect(within(scanning).queryByText(/weren't found/)).toBeNull();
});

test("failed jobs say what failed and run again, one or all, or are cleared", async () => {
  mockAccount();
  const broken = failedJob("import_track", "uploads/bad.mp3", "can't sync to MPEG frame");
  const admin = mockAdmin({
    failed: [
      broken,
      failedJob("fetch_lyrics", "Северный Ветер — Рассвет", "ConnectError: timed out"),
      failedJob("housekeeping", null, "OSError: disk full"),
    ],
  });
  const { user } = renderSignedIn("/admin");
  const jobs = await screen.findByRole("region", { name: "Background work" });
  expect(await within(jobs).findByRole("heading", { name: "Errors · 3" })).toBeVisible();
  expect(within(jobs).getByText("uploads/bad.mp3")).toBeVisible();
  expect(within(jobs).getByText("can't sync to MPEG frame")).toBeVisible();
  expect(within(jobs).getByText("Finding lyrics")).toBeVisible();

  await user.click(within(jobs).getByRole("button", { name: "Try again: uploads/bad.mp3" }));
  await waitFor(() => expect(toast()).toBe("1 job will run again"));
  expect(admin.calls.at(-1)?.path).toBe(`/api/v1/library/jobs/${broken.id}/retry`);
  expect(await within(jobs).findByRole("heading", { name: "Errors · 2" })).toBeVisible();
  // Without a subject, the kind of job names it.
  expect(within(jobs).getByRole("button", { name: "Try again: Clean-up" })).toBeVisible();

  await user.click(within(jobs).getByRole("button", { name: "Try all again" }));
  await waitFor(() => expect(toast()).toBe("2 jobs will run again"));
  expect(await within(jobs).findByText("No errors.")).toBeVisible();

  admin.state.failed = [failedJob("transcode", "A — B", "ffmpeg timed out")];
  admin.state.summary = { ...admin.state.summary, failed: 1 };
  const tabs = screen.getByRole("navigation", { name: "Administration sections" });
  await user.click(within(tabs).getByRole("link", { name: "Users" }));
  await user.click(within(tabs).getByRole("link", { name: "Library" }));
  await user.click(await within(card("Background work")).findByRole("button", { name: "Clear" }));
  await waitFor(() => expect(toast()).toBe("The errors are cleared."));
  expect(await within(card("Background work")).findByText("No errors.")).toBeVisible();
});

test("uploaded files are followed until they are in the library", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockAccount();
  const admin = mockAdmin();
  const { user, container } = renderSignedIn("/admin/uploads");
  expect(await screen.findByRole("region", { name: "Upload music" })).toBeVisible();
  expect(document.title).toBe("Upload · Administration — Thule");

  const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
  // The mock server reads the name from the content: jsdom sends files as "blob".
  const audio = (name: string) => new File([name], name, { type: "audio/mpeg" });
  await user.upload(input, [
    audio("02 Two.mp3"),
    audio("01 One.mp3"),
    audio("dup Old.mp3"),
    audio("broken.mp3"),
  ]);
  const list = await screen.findByRole("region", { name: "Uploaded files" });
  await waitFor(() => expect(within(list).getAllByText("Adding to the library…")).toHaveLength(3));
  expect(admin.calls.filter((call) => call.path === "/api/v1/library/uploads")).toHaveLength(4);
  expect(within(list).getByText("Already in the library")).toBeVisible();
  // What isn't music, a cover or lyrics is left out (the folder picker takes any file).
  const folderInput = container.querySelector<HTMLInputElement>("input[webkitdirectory]")!;
  await user.upload(folderInput, new File(["#"], "notes.md"));
  expect(screen.getByText("1 file skipped: not music, a cover or lyrics.")).toBeVisible();

  const done = album("Тихие города", WIND);
  admin.state.imports.set("uploads/01 One.mp3", {
    path: "uploads/01 One.mp3",
    state: "imported",
    error: null,
    track: track("One", done),
  });
  admin.state.imports.set("uploads/02 Two.mp3", {
    path: "uploads/02 Two.mp3",
    state: "imported",
    error: null,
    track: track("Two", done),
  });
  admin.state.imports.set("uploads/broken.mp3", {
    path: "uploads/broken.mp3",
    state: "failed",
    error: "can't sync to MPEG frame",
    track: null,
  });
  await vi.advanceTimersByTimeAsync(1500);
  await waitFor(() => expect(within(list).getAllByText(/^Added ·/)).toHaveLength(2));
  expect(within(list).getAllByRole("link", { name: "Тихие города" })[0]).toHaveAttribute(
    "href",
    `/albums/${done.id}`,
  );
  expect(within(list).getByText("Couldn't be added")).toBeVisible();
  expect(within(list).getByText("can't sync to MPEG frame")).toBeVisible();
  expect(within(list).getByText("4 of 4 done")).toBeVisible();
  await waitFor(() => expect(toast()).toBe("Uploaded: 2 files added, 1 failed."));

  await user.click(within(list).getByRole("button", { name: "Clear the list" }));
  expect(screen.queryByRole("region", { name: "Uploaded files" })).toBeNull();
});

test("an upload the server can't store says why", async () => {
  mockAccount();
  mockAdmin();
  const { user, container } = renderSignedIn("/admin/uploads");
  await screen.findByRole("region", { name: "Upload music" });
  const input = container.querySelector<HTMLInputElement>('input[type="file"][multiple]')!;
  await user.upload(
    input,
    new File(["readonly One.mp3"], "readonly One.mp3", { type: "audio/mpeg" }),
  );
  const list = await screen.findByRole("region", { name: "Uploaded files" });
  expect(
    await within(list).findByText(
      "The server can't write to the music folder: check that folder's owner and permissions.",
    ),
  ).toBeVisible();
  expect(within(list).getByRole("button", { name: "Upload readonly One.mp3 again" })).toBeVisible();
});

test("users: who they are, a new one, a role, a password, signing out, deleting", async () => {
  mockAccount();
  const admin = mockAdmin();
  const { user } = renderSignedIn("/admin/users");
  const users = await screen.findByRole("region", { name: "Users" });
  const rows = await within(users).findAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("Ada Lovelaceyou");
  expect(rows[0]).toHaveTextContent("Last active now · Signed in on 1 device");
  // There is nothing to do about oneself here: the settings are for that.
  expect(within(rows[0]!).queryByRole("button")).toBeNull();
  expect(rows[1]).toHaveTextContent("grace · User · Since 1 February 2026");
  expect(rows[1]).toHaveTextContent("Signed in on 2 devices");

  // A new user.
  await user.click(within(users).getByRole("button", { name: "New user" }));
  let dialog = screen.getByRole("dialog", { name: "New user" });
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(within(dialog).getByLabelText("Username")).toHaveAccessibleDescription(
    "Fill in this field",
  );
  expect(within(dialog).getByLabelText("Username")).toHaveFocus();
  await user.type(within(dialog).getByLabelText("Username"), "grace");
  await user.type(within(dialog).getByLabelText("Password"), "a-long-password");
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  expect(await within(dialog).findByText("This username is already taken.")).toBeVisible();
  await user.clear(within(dialog).getByLabelText("Username"));
  await user.type(within(dialog).getByLabelText("Username"), "linus");
  await user.type(within(dialog).getByLabelText(/^Name/), "Linus");
  await user.click(within(dialog).getByRole("radio", { name: "Administrator" }));
  await user.click(within(dialog).getByRole("button", { name: "Create" }));
  await waitFor(() => expect(toast()).toBe("linus can sign in now"));
  expect(admin.calls.at(-1)?.body).toEqual({
    username: "linus",
    password: "a-long-password",
    display_name: "Linus",
    role: "admin",
  });
  expect(await within(users).findByText("Linus")).toBeVisible();
  expect(within(users).getByText(/Hasn't signed in yet/)).toBeVisible();

  // Grace becomes an administrator.
  const actions = () => within(users).getByRole("button", { name: "Actions for Grace Hopper" });
  await user.click(actions());
  await user.click(screen.getByRole("menuitem", { name: "Make administrator" }));
  await waitFor(() => expect(toast()).toBe("Grace Hopper is now: administrator"));
  expect(admin.calls.at(-1)).toMatchObject({ method: "PATCH", body: { role: "admin" } });

  // A new password for her.
  await user.click(actions());
  await user.click(screen.getByRole("menuitem", { name: "Set a new password" }));
  dialog = screen.getByRole("dialog", { name: "New password for Grace Hopper" });
  expect(dialog).toHaveAccessibleDescription("They will be signed out on all devices.");
  await user.type(within(dialog).getByLabelText("New password"), "short");
  await user.click(within(dialog).getByRole("button", { name: "Set password" }));
  expect(within(dialog).getByLabelText("New password")).toHaveAccessibleDescription(
    "At least 8 characters",
  );
  await user.type(within(dialog).getByLabelText("New password"), "-but-longer");
  await user.click(within(dialog).getByRole("button", { name: "Set password" }));
  await waitFor(() => expect(toast()).toBe("The password of Grace Hopper is changed"));
  expect(admin.calls.at(-1)?.body).toEqual({ new_password: "short-but-longer" });

  // Signed out everywhere.
  await user.click(actions());
  await user.click(screen.getByRole("menuitem", { name: "Sign out everywhere" }));
  dialog = screen.getByRole("dialog", { name: "Sign Grace Hopper out everywhere?" });
  await user.click(within(dialog).getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(toast()).toBe("Grace Hopper is signed out everywhere"));
  await waitFor(() => expect(within(users).queryByText(/Signed in on 2 devices/)).toBeNull());

  // And deleted.
  await user.click(actions());
  await user.click(screen.getByRole("menuitem", { name: "Delete user" }));
  dialog = screen.getByRole("dialog", { name: "Delete Grace Hopper?" });
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(toast()).toBe("Grace Hopper is deleted"));
  await waitFor(() => expect(within(users).queryByText("Grace Hopper")).toBeNull());
  expect(admin.calls.at(-1)).toMatchObject({
    method: "DELETE",
    path: "/api/v1/users/grace",
  });
});

const nothing = {
  files: 50,
  added: 0,
  updated: 0,
  moved: 0,
  removed: 0,
  missing: 0,
  unreadable: 0,
};

function counts(partial: Partial<Record<"queued" | "running" | "done" | "failed", number>>) {
  return { queued: 0, running: 0, done: 0, failed: 0, ...partial };
}

function now() {
  return new Date().toISOString();
}
