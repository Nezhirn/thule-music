import { FakeAudio } from "../test/audio";
import { album, track, WIND } from "../test/catalog";
import { createPlayer } from "./player";
import { playOneTabAtATime } from "./tabs";

const ALBUM = album("Ветер", WIND);
const TRACKS = ["A", "B"].map((title) => track(title, ALBUM));

function tab(name: string) {
  const player = createPlayer({
    audio: new FakeAudio().asAudio(),
    streamUrl: () => new Promise(() => {}),
    scrobble: async () => {},
    quality: () => "high",
  });
  return { player, disconnect: playOneTabAtATime(player, name) };
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
