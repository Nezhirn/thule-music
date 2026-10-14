import type { Schemas } from "../api/client";
import { album, track, WIND } from "../test/catalog";
import { choose, createUploads, type Picked, type UploadsDeps } from "./uploads";

const file = (name: string, folder = "") => ({ file: new File(["x"], name), folder });
const names = (picked: Picked[]) => picked.map(({ file, folder }) => `${folder}/${file.name}`);

test("music, album covers and lyrics beside tracks are chosen, covers and lyrics first", () => {
  const { chosen, skipped } = choose([
    file("02 Two.flac", "A/Album"),
    file("01 One.flac", "A/Album"),
    file("10 Ten.flac", "A/Album"),
    file("cover.jpg", "A/Album"),
    file("back.jpg", "A/Album"),
    file("01 One.lrc", "A/Album"),
    file("info.txt", "A/Album"),
    file(".DS_Store", "A/Album"),
    file("song.mp3", ".hidden"),
    file("loose.opus"),
  ]);
  expect(names(chosen)).toEqual([
    "A/Album/01 One.lrc",
    "A/Album/cover.jpg",
    "/loose.opus",
    "A/Album/01 One.flac",
    "A/Album/02 Two.flac",
    "A/Album/10 Ten.flac",
  ]);
  // back.jpg and info.txt; hidden files aren't counted.
  expect(skipped).toBe(2);
});

/** A server answering by hand: each upload waits until the test settles it. */
function fakeServer() {
  const sent: {
    name: string;
    folder: string;
    settle(result: Schemas["UploadResult"] | Error): void;
  }[] = [];
  const statuses = new Map<string, Schemas["ImportStatus"]>();
  const finished = vi.fn();
  const deps: UploadsDeps = {
    send: (file, folder, onProgress) =>
      new Promise((resolve, reject) => {
        onProgress(0.5);
        sent.push({
          name: file.name,
          folder,
          settle: (result) => (result instanceof Error ? reject(result) : resolve(result)),
        });
      }),
    status: async (paths) =>
      paths.map(
        (path) => statuses.get(path) ?? { path, state: "queued", error: null, track: null },
      ),
    finished,
  };
  return { deps, sent, statuses, finished };
}

const ALBUM = album("Тихие города", WIND);
const SONG = track("Рассвет", ALBUM);

test("uploads go two at a time, the album's cover before its tracks", async () => {
  vi.useFakeTimers();
  const server = fakeServer();
  const uploads = createUploads(server.deps);
  const stages = () => uploads.store.getState().items.map((item) => item.state.stage);
  uploads.add([file("01.flac", "W/T"), file("02.flac", "W/T"), file("cover.jpg", "W/T")]);

  // Only the cover: the tracks wait for it.
  expect(server.sent.map((s) => s.name)).toEqual(["cover.jpg"]);
  expect(uploads.store.getState().items[0]?.state).toEqual({ stage: "uploading", progress: 0.5 });
  server.sent[0]?.settle({ path: "uploads/W/T/cover.jpg", duplicate: false });
  await vi.waitFor(() => expect(server.sent).toHaveLength(3));
  expect(server.sent.map((s) => `${s.folder}/${s.name}`)).toEqual([
    "W/T/cover.jpg",
    "W/T/01.flac",
    "W/T/02.flac",
  ]);

  server.sent[1]?.settle({ path: "uploads/W/T/01.flac", duplicate: false });
  server.sent[2]?.settle({ path: "A/02.flac", duplicate: true });
  await vi.waitFor(() => expect(stages()).toEqual(["saved", "importing", "duplicate"]));

  // The server adds the first; the duplicate is the track that was there already.
  server.statuses.set("uploads/W/T/01.flac", {
    path: "uploads/W/T/01.flac",
    state: "imported",
    error: null,
    track: SONG,
  });
  server.statuses.set("A/02.flac", {
    path: "A/02.flac",
    state: "imported",
    error: null,
    track: SONG,
  });
  await vi.advanceTimersByTimeAsync(1500);
  expect(stages()).toEqual(["saved", "added", "duplicate"]);
  expect(uploads.store.getState().items[2]?.state).toMatchObject({ track: SONG });
  expect(server.finished).toHaveBeenCalledTimes(1);
  expect(uploads.store.getState().finished).toEqual({ added: 1, failed: 0 });
  vi.useRealTimers();
});

test("a file that didn't get through can be sent again; one the server can't add can't", async () => {
  vi.useFakeTimers();
  const server = fakeServer();
  const uploads = createUploads(server.deps);
  const items = () => uploads.store.getState().items;
  uploads.add([file("a.mp3"), file("b.mp3")]);
  server.sent[0]?.settle(new TypeError("Network error"));
  server.sent[1]?.settle({ path: "uploads/b.mp3", duplicate: false });
  await vi.waitFor(() => expect(items()[0]?.state.stage).toBe("error"));

  server.statuses.set("uploads/b.mp3", {
    path: "uploads/b.mp3",
    state: "failed",
    error: "can't sync to MPEG frame",
    track: null,
  });
  await vi.advanceTimersByTimeAsync(1500);
  expect(items()[1]?.state).toEqual({
    stage: "failed",
    path: "uploads/b.mp3",
    error: "can't sync to MPEG frame",
  });
  expect(uploads.store.getState().finished).toEqual({ added: 0, failed: 2 });

  uploads.retry(items()[0]!.id);
  expect(server.sent).toHaveLength(3);
  server.sent[2]?.settle({ path: "uploads/a.mp3", duplicate: false });
  await vi.waitFor(() => expect(items()[0]?.state.stage).toBe("importing"));

  // Clearing keeps what is still going.
  uploads.clear();
  expect(items().map((item) => item.file.name)).toEqual(["a.mp3"]);
  vi.useRealTimers();
});

test("signing out stops the uploads and forgets them", () => {
  const server = fakeServer();
  const signals: AbortSignal[] = [];
  const uploads = createUploads({
    ...server.deps,
    send: (_file, _folder, _progress, signal) => {
      signals.push(signal);
      return new Promise(() => {});
    },
  });
  uploads.add([file("a.mp3"), file("b.mp3"), file("c.mp3")]);
  expect(signals).toHaveLength(2);
  uploads.reset();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(uploads.store.getState()).toEqual({
    items: [],
    skipped: 0,
    finished: null,
    importsStuck: false,
  });
});

test("files can be cancelled before or while they are sent; the next ones go on", () => {
  const server = fakeServer();
  const signals = new Map<string, AbortSignal>();
  const uploads = createUploads({
    ...server.deps,
    send: (file, _folder, _progress, signal) => {
      signals.set(file.name, signal);
      return new Promise(() => {});
    },
  });
  uploads.add([file("a.mp3"), file("b.mp3"), file("c.mp3"), file("d.mp3")]);
  const names = () => uploads.store.getState().items.map((item) => item.file.name);
  const [a, , c] = uploads.store.getState().items;
  // One being sent: stopped, and the next waiting one starts in its place.
  uploads.cancel([a!.id]);
  expect(signals.get("a.mp3")?.aborted).toBe(true);
  expect([...signals.keys()]).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
  // One waiting: just taken out.
  uploads.cancel([c!.id]);
  expect(names()).toEqual(["b.mp3", "d.mp3"]);
  expect([...signals.keys()]).toEqual(["a.mp3", "b.mp3", "c.mp3", "d.mp3"]);
  // The rest.
  uploads.cancel();
  expect(names()).toEqual([]);
  expect(signals.get("b.mp3")?.aborted).toBe(true);
  expect(signals.get("d.mp3")?.aborted).toBe(true);
});

test("imports that wait long with none done say the worker may not be running", async () => {
  vi.useFakeTimers();
  const server = fakeServer();
  let now = 0;
  const uploads = createUploads({ ...server.deps, now: () => now });
  const stuck = () => uploads.store.getState().importsStuck;
  uploads.add([file("a.mp3"), file("b.mp3")]);
  server.sent[0]?.settle({ path: "uploads/a.mp3", duplicate: false });
  server.sent[1]?.settle({ path: "uploads/b.mp3", duplicate: false });
  await vi.waitFor(() =>
    expect(uploads.store.getState().items.every((i) => i.state.stage === "importing")).toBe(true),
  );
  for (let waited = 0; waited < 30_000; waited += 1500) {
    now += 1500;
    await vi.advanceTimersByTimeAsync(1500);
  }
  expect(stuck()).toBe(true);
  // One added: the worker is there after all.
  server.statuses.set("uploads/a.mp3", {
    path: "uploads/a.mp3",
    state: "imported",
    error: null,
    track: SONG,
  });
  now += 1500;
  await vi.advanceTimersByTimeAsync(1500);
  expect(stuck()).toBe(false);
  vi.useRealTimers();
});
