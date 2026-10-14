import { FakeAudio } from "../test/audio";
import { album, track, WIND } from "../test/catalog";
import { createPlayer } from "./player";
import { playOneTabAtATime } from "./tabs";

const ALBUM = album("Ветер", WIND);
const TRACKS = ["A", "B"].map((title) => track(title, ALBUM));

function tab(name: string, now?: () => number) {
  const player = createPlayer({
    audio: new FakeAudio().asAudio(),
    streamUrl: () => new Promise(() => {}),
    scrobble: async () => {},
    quality: () => "high",
  });
  return { player, disconnect: playOneTabAtATime(player, name, now) };
}

test("a tab starting to play pauses the one playing", async () => {
  const first = tab("first");
  const second = tab("second");
  first.player.play(TRACKS);
  await vi.waitFor(() => expect(first.player.store.getState().playing).toBe(true));
  second.player.play(TRACKS);
  await vi.waitFor(() => expect(first.player.store.getState().playing).toBe(false));
  expect(second.player.store.getState().playing).toBe(true);
  first.disconnect();
  second.disconnect();
});

test("two tabs starting in the same moment don't pause each other: one plays on", async () => {
  const now = () => 1000;
  const first = tab("first", now);
  const second = tab("second", now);
  // Both start before either hears of the other.
  first.player.play(TRACKS);
  second.player.play(TRACKS);
  await vi.waitFor(() => expect(first.player.store.getState().playing).toBe(false));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(second.player.store.getState().playing).toBe(true);
  first.disconnect();
  second.disconnect();
});
