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
  save({ v: 1, queue, source: null, repeat: "off", position: 3 });
  expect(loadSaved()?.position).toBe(3);
  save({ v: 0, queue, source: null, repeat: "off", position: 3 });
  expect(loadSaved()).toBeNull();
  save({ v: 1, queue: { ...queue, current: 1 }, source: null, repeat: "off", position: 3 });
  expect(loadSaved()).toBeNull();
  save({ v: 1, queue: { ...queue, items: [{ key: "a" }] }, source: null });
  expect(loadSaved()).toBeNull();
  save({ v: 1, queue, source: { type: 1 }, repeat: "sometimes", position: -1 });
  expect(loadSaved()).toMatchObject({ source: null, repeat: "off", position: 0 });
  localStorage.setItem("thule.player", "{");
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
