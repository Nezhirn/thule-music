import type { Track } from "../catalog/queries";
import { FakeAudio } from "../test/audio";
import { album, track, WIND } from "../test/catalog";
import { forgetSaved, keepSaved, loadSaved, loadVolume } from "./persist";
import { createPlayer } from "./player";

const ALBUM = album("Ветер", WIND);
const TRACKS = ["A", "B"].map((title) => track(title, ALBUM));

function setup() {
  let now = 0;
  const audio = new FakeAudio();
  const player = createPlayer({
    audio: audio.asAudio(),
    streamUrl: () => new Promise(() => {}),
    scrobble: async () => {},
    quality: () => "high",
  });
  const stop = keepSaved(player, () => now);
  return { player, audio, stop, later: (ms: number) => (now += ms) };
}

test("the queue, its source and repeat are saved and come back", () => {
  const { player, stop } = setup();
  player.play(TRACKS, { start: 1, source: { type: "album", id: ALBUM.id } });
  player.setRepeat("one");
  player.pause();
  player.seek(42);
  stop();
  const saved = loadSaved();
  expect(saved?.queue.items.map((item) => item.track.title)).toEqual(["A", "B"]);
  expect(saved).toMatchObject({
    source: { type: "album", id: ALBUM.id },
    repeat: "one",
    position: 42,
    queue: { current: 1, unshuffled: null },
  });
});

test("while playing, the position is saved every few seconds and when the page hides", () => {
  const { player, later } = setup();
  player.play(TRACKS);
  const position = () => loadSaved()?.position;
  player.store.setState({ position: 1 });
  expect(position()).toBe(0);
  later(5000);
  player.store.setState({ position: 6 });
  expect(position()).toBe(6);
  player.store.setState({ position: 7 });
  window.dispatchEvent(new Event("pagehide"));
  expect(position()).toBe(7);
});

test("an emptied queue is forgotten, and so on signing out", () => {
  const { player } = setup();
  player.play(TRACKS);
  expect(loadSaved()).not.toBeNull();
  player.reset();
  expect(loadSaved()).toBeNull();
  player.play(TRACKS);
  forgetSaved();
  expect(loadSaved()).toBeNull();
});

test("saves that don't fit are ignored", () => {
  const item = { key: "a", track: TRACKS[0] as Track };
  const save = (value: unknown) => localStorage.setItem("thule.player", JSON.stringify(value));
  const queue = { items: [item], current: 0, unshuffled: null };
  save({ v: 2, queue, source: null, repeat: "off", position: 3 });
  expect(loadSaved()?.position).toBe(3);
  save({ v: 0, queue, source: null, repeat: "off", position: 3 });
  expect(loadSaved()).toBeNull();
  save({ v: 2, queue: { ...queue, current: 1 }, source: null, repeat: "off", position: 3 });
  expect(loadSaved()).toBeNull();
  save({ v: 2, queue: { ...queue, items: [{ key: "a" }] }, source: null });
  expect(loadSaved()).toBeNull();
  save({ v: 2, queue, source: { type: 1 }, repeat: "sometimes", position: -1 });
  expect(loadSaved()).toMatchObject({ source: null, repeat: "off", position: 0 });
  localStorage.setItem("thule.player", "{");
  expect(loadSaved()).toBeNull();
});

test("a queue saved before tracks had pictures of their own shows their albums' covers", () => {
  const older: Partial<Track> = { ...TRACKS[0]! };
  delete older.cover_id;
  delete older.cover_palette;
  const queue = { items: [{ key: "a", track: older }], current: 0, unshuffled: null };
  localStorage.setItem(
    "thule.player",
    JSON.stringify({ v: 1, queue, source: null, repeat: "off", position: 3 }),
  );
  const [item] = loadSaved()!.queue.items;
  expect(item!.track).toEqual(TRACKS[0]);
  expect(item!.track.cover_id).toBe(ALBUM.cover_id);
});

test("a shuffled queue comes back with the order to go back to", () => {
  const { player, stop } = setup();
  player.play([...TRACKS, track("C", ALBUM)], { shuffle: true });
  const before = player.store.getState().queue;
  stop();
  const saved = loadSaved()!;
  expect(saved.queue).toEqual(before);
  // Saved as keys, not the tracks again.
  const raw = JSON.parse(localStorage.getItem("thule.player")!) as {
    queue: { unshuffled: unknown[] };
  };
  expect(raw.queue.unshuffled.every((key) => typeof key === "string")).toBe(true);
});

test("a queue too big for the browser's storage is saved as the tracks around the current one", () => {
  const many = Array.from({ length: 1200 }, (_, i) => track(`T${i}`, ALBUM));
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (value.length > 400_000) throw new DOMException("full", "QuotaExceededError");
    setItem.call(this, key, value);
  });
  const { player, stop } = setup();
  player.play(many, { start: 700, shuffle: true });
  stop();
  const saved = loadSaved()!;
  expect(saved.queue.items.length).toBeLessThan(many.length);
  expect(saved.queue.items[saved.queue.current]?.track.title).toBe("T700");
  expect(saved.queue.unshuffled).toBeNull();
  forgetSaved();
});

test("this page's position doesn't write over another tab's newer queue", () => {
  const { player, later } = setup();
  player.play(TRACKS);
  player.pause();
  // Another tab plays something else meanwhile and saves it.
  const other = { key: "other", track: track("Other", ALBUM) };
  localStorage.setItem(
    "thule.player",
    JSON.stringify({ v: 3, queue: { items: [other], current: 0, unshuffled: null } }),
  );
  later(10_000);
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("pagehide"));
  expect(loadSaved()?.queue.items.map((item) => item.key)).toEqual(["other"]);
});

test("a save whose tracks aren't tracks any more is ignored", () => {
  const item = { key: "a", track: { ...TRACKS[0]!, artist: "Ветер" } };
  localStorage.setItem(
    "thule.player",
    JSON.stringify({ v: 3, queue: { items: [item], current: 0, unshuffled: null } }),
  );
  expect(loadSaved()).toBeNull();
  const unknownKey = { items: [{ key: "a", track: TRACKS[0] }], current: 0, unshuffled: ["b"] };
  localStorage.setItem("thule.player", JSON.stringify({ v: 3, queue: unknownKey }));
  expect(loadSaved()).toBeNull();
});

test("the volume is kept for the device", () => {
  const { player } = setup();
  player.setVolume(0.4);
  player.setMuted(true);
  expect(loadVolume()).toEqual({ volume: 0.4, muted: true });
  player.reset();
  expect(loadVolume()).toEqual({ volume: 0.4, muted: true });
});
