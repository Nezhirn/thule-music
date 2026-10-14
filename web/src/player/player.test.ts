import { ApiFailure } from "../api/errors";
import type { Track } from "../catalog/queries";
import { FakeAudio } from "../test/audio";
import { album, track, WIND } from "../test/catalog";
import { createPlayer, type Quality, type StreamUrl } from "./player";
import { currentItem, upcoming } from "./queue";

const ALBUM = album("Ветер", WIND);
const TRACKS = ["A", "B", "C"].map((title) =>
  track(title, ALBUM, [WIND], { duration_ms: 187_000 }),
);
const [A, B, C] = TRACKS as [Track, Track, Track];
const HOUR = 3600_000;

// Lets pending promises (the stream URL request) settle.
const settle = () => new Promise((resolve) => setTimeout(resolve));

function setup({ opus = true } = {}) {
  const audio = new FakeAudio();
  audio.opus = opus;
  const requests: { track: string; quality: Quality }[] = [];
  const scrobbles: { track: string; ms: number; at?: string }[] = [];
  let quality: Quality = "high";
  let now = Date.parse("2026-10-13T10:00:00Z");
  let streamUrl = async (trackId: string, wanted: Quality): Promise<StreamUrl> => {
    requests.push({ track: trackId, quality: wanted });
    return {
      url: `/stream/${trackId}?quality=${wanted}&n=${requests.length}`,
      quality: wanted,
      codec: wanted === "original" ? "flac" : "opus",
      bitrate: wanted === "original" ? 900 : 160,
      expires_at: new Date(now + 6 * HOUR).toISOString(),
    };
  };
  const player = createPlayer({
    audio: audio.asAudio(),
    streamUrl: (trackId, wanted) => streamUrl(trackId, wanted),
    scrobble: async (trackId, ms, at) => {
      scrobbles.push({ track: trackId, ms, at });
    },
    quality: () => quality,
    now: () => now,
    random: () => 0,
  });
  const state = () => player.store.getState();
  return {
    audio,
    player,
    state,
    requests,
    scrobbles,
    playing: () => currentItem(state().queue)?.track.title,
    setQuality: (value: Quality) => (quality = value),
    later: (ms: number) => (now += ms),
    replaceStreamUrl: (fn: typeof streamUrl) => (streamUrl = fn),
  };
}

test("plays a track from a stream URL at the chosen quality", async () => {
  const { audio, player, state, requests, playing } = setup();
  player.play(TRACKS, { start: 1, source: { type: "album", id: ALBUM.id } });
  expect(state().playing).toBe(true);
  expect(state().duration).toBe(187); // from the tags until the stream says
  await settle();
  expect(requests).toEqual([{ track: B.id, quality: "high" }]);
  expect(audio.src).toContain(`/stream/${B.id}`);
  expect(audio.paused).toBe(false);
  expect(playing()).toBe("B");
  expect(state().stream).toEqual({ quality: "high", codec: "opus", bitrate: 160 });
  expect(state().source).toEqual({ type: "album", id: ALBUM.id });
  audio.start(186.5);
  expect(state().duration).toBe(186.5);
  audio.advance(10);
  expect(state().position).toBe(10);
});

test("asks for the original where Opus doesn't play", async () => {
  const { player, requests } = setup({ opus: false });
  player.play([A]);
  await settle();
  expect(requests[0]?.quality).toBe("original");
});

test("goes on to the next track, and stops at the end on the first", async () => {
  const { audio, player, state, requests, playing } = setup();
  player.play(TRACKS, { start: 1 });
  await settle();
  audio.start(187);
  audio.finish();
  await settle();
  expect(playing()).toBe("C");
  expect(state().playing).toBe(true);
  audio.start(187);
  audio.finish();
  await settle();
  // Back at the start, stopped; the stream is only asked for on play.
  expect(playing()).toBe("A");
  expect(state().playing).toBe(false);
  expect(state().position).toBe(0);
  expect(requests).toHaveLength(2);
  player.resume();
  await settle();
  expect(requests.at(-1)?.track).toBe(A.id);
  expect(state().playing).toBe(true);
});

test("repeats the queue or one track", async () => {
  const { audio, player, requests, playing } = setup();
  player.play(TRACKS, { start: 2 });
  player.setRepeat("all");
  await settle();
  audio.start(187);
  audio.finish();
  await settle();
  expect(playing()).toBe("A");

  player.setRepeat("one");
  audio.start(187);
  audio.finish();
  await settle();
  expect(playing()).toBe("A");
  expect(audio.paused).toBe(false);
  expect(audio.currentTime).toBe(0);
  expect(requests).toHaveLength(2); // the same stream again
});

test("next and previous by hand; previous restarts a track after 3 seconds", async () => {
  const { audio, player, state, playing } = setup();
  player.play(TRACKS);
  await settle();
  player.next();
  await settle();
  expect(playing()).toBe("B");
  audio.start(187);
  audio.advance(20);
  player.previous();
  expect(playing()).toBe("B");
  expect(audio.currentTime).toBe(0);
  expect(state().position).toBe(0);
  player.previous();
  await settle();
  expect(playing()).toBe("A");
  // At the first track it starts it over.
  player.previous();
  expect(playing()).toBe("A");
  // No next at the end without repeat.
  player.play(TRACKS, { start: 2 });
  await settle();
  player.next();
  expect(playing()).toBe("C");
});

test("scrobbles once after 30 seconds of listening, or half of a short track", async () => {
  const { audio, player, scrobbles, later } = setup();
  const short = track("Short", ALBUM, [WIND], { duration_ms: 40_000 });
  player.play([A, short]);
  await settle();
  audio.start(187);
  audio.advance(20);
  // A seek isn't listening.
  audio.currentTime = 150;
  audio.emit("seeked");
  audio.advance(159.75);
  expect(scrobbles).toEqual([]);
  audio.advance(160);
  // With when it was started: a play sent later lands where it belongs in the history.
  expect(scrobbles).toEqual([{ track: A.id, ms: 30_000, at: "2026-10-13T10:00:00.000Z" }]);
  audio.advance(186);
  expect(scrobbles).toHaveLength(1);

  later(187_000);
  audio.finish();
  await settle();
  audio.start(40);
  audio.advance(20);
  expect(scrobbles.at(-1)).toEqual({ track: short.id, ms: 20_000, at: "2026-10-13T10:03:07.000Z" });
});

test("a repeated track counts again; a paused one doesn't count", async () => {
  const { audio, player, scrobbles } = setup();
  player.play([A]);
  player.setRepeat("one");
  await settle();
  audio.start(187);
  player.pause();
  audio.currentTime = 40; // time updates while paused (e.g. after a seek) aren't listening
  audio.emit("timeupdate");
  expect(scrobbles).toEqual([]);
  player.resume();
  audio.advance(70);
  expect(scrobbles).toHaveLength(1);
  audio.finish();
  audio.advance(30);
  expect(scrobbles).toHaveLength(2);
});

test("a broken stream is renewed once, then skipped", async () => {
  const { audio, player, state, requests, playing } = setup();
  player.play(TRACKS);
  await settle();
  audio.start(187);
  audio.advance(42);
  audio.fail();
  await settle();
  // Renewed at the same place, still playing.
  expect(requests.filter((request) => request.track === A.id)).toHaveLength(2);
  expect(audio.currentTime).toBe(42);
  expect(audio.paused).toBe(false);
  audio.fail();
  await settle();
  expect(playing()).toBe("B");
  expect(state().failed?.id).toBe(A.id);
  audio.start(187);
  expect(state().failed).toBeNull();
});

test("gives up after three tracks in a row fail", async () => {
  const { player, state, replaceStreamUrl } = setup();
  const missing = { code: "audio_file_missing", detail: "Audio file is missing on disk" };
  replaceStreamUrl(() =>
    Promise.reject(new ApiFailure(new Response(null, { status: 404 }), missing)),
  );
  player.play([...TRACKS, A]);
  await settle();
  await settle();
  await settle();
  expect(currentItem(state().queue)?.track.id).toBe(C.id);
  expect(state().playing).toBe(false);
  expect(state().failed?.id).toBe(C.id);
});

test("without an answer from the server it stops at the track instead of skipping", async () => {
  // Offline, or the page reloaded while the stream URL was on its way: the queue must not
  // move on, or the reloaded page would come back at the next track.
  const { audio, player, state, requests, playing, replaceStreamUrl } = setup();
  const answer = (trackId: string) => {
    requests.push({ track: trackId, quality: "high" });
    return Promise.reject(new TypeError("Failed to fetch"));
  };
  replaceStreamUrl(answer);
  player.play(TRACKS);
  await settle();
  expect(playing()).toBe("A");
  expect(state().playing).toBe(false);
  expect(state().failed?.id).toBe(A.id);
  expect(requests).toHaveLength(1);

  // Back online, playing again asks again.
  replaceStreamUrl(async (trackId) => ({
    url: `/stream/${trackId}`,
    quality: "high",
    codec: "opus",
    bitrate: 160,
    expires_at: new Date(Date.parse("2026-10-13T16:00:00Z")).toISOString(),
  }));
  player.toggle();
  await settle();
  expect(audio.src).toContain(`/stream/${A.id}`);
  expect(audio.paused).toBe(false);
});

test("the next track's stream is asked for while one plays, and starts at its end at once", async () => {
  const { audio, player, requests } = setup();
  player.play(TRACKS);
  await settle();
  audio.start(187);
  audio.advance(1);
  expect(requests.map((request) => request.track)).toEqual([A.id, B.id]);
  await settle();
  audio.advance(10);
  expect(requests).toHaveLength(2);
  audio.finish();
  // Within the "ended" event, no waiting for the server: phones keep playing then.
  expect(audio.src).toContain(`/stream/${B.id}`);
  expect(audio.paused).toBe(false);
  expect(requests).toHaveLength(2);
});

test("a queue changed while a track plays prefetches what now comes next", async () => {
  const { audio, player, requests, playing } = setup();
  player.play([A, B]);
  await settle();
  audio.start(187);
  audio.advance(1);
  player.playNext([C]);
  audio.advance(2);
  await settle();
  expect(requests.map((request) => request.track)).toEqual([A.id, B.id, C.id]);
  audio.finish();
  expect(playing()).toBe("C");
  expect(audio.src).toContain(`/stream/${C.id}`);
  expect(requests).toHaveLength(3);
});

test("a prefetched URL that expired meanwhile is asked for again", async () => {
  const { audio, player, requests, later, playing } = setup();
  player.play(TRACKS);
  await settle();
  audio.start(187);
  audio.advance(1);
  await settle();
  player.pause();
  later(6 * HOUR);
  player.next();
  await settle();
  expect(playing()).toBe("B");
  expect(requests.map((request) => request.track)).toEqual([A.id, B.id, B.id]);
  expect(audio.src).toContain("n=3");
});

test("paused while the stream URL is on its way: it stays paused when it comes", async () => {
  const { audio, player, state, replaceStreamUrl } = setup();
  const pending: ((url: StreamUrl) => void)[] = [];
  replaceStreamUrl(() => new Promise((resolve) => pending.push(resolve)));
  player.play([A]);
  player.pause();
  pending[0]!({
    url: `/stream/${A.id}`,
    quality: "high",
    codec: "opus",
    bitrate: 160,
    expires_at: "2026-10-13T16:00:00Z",
  });
  await settle();
  expect(audio.paused).toBe(true);
  expect(state().playing).toBe(false);
  // Play asks again.
  player.resume();
  expect(pending).toHaveLength(2);
  expect(state().playing).toBe(true);
});

test("the server's trouble stops at the track; it plays on when the connection is back", async () => {
  // A 502 from the proxy while the server restarts: the queue isn't skipped through.
  const { audio, player, state, requests, playing, replaceStreamUrl } = setup();
  const working = async (trackId: string): Promise<StreamUrl> => {
    requests.push({ track: trackId, quality: "high" });
    return {
      url: `/stream/${trackId}`,
      quality: "high",
      codec: "opus",
      bitrate: 160,
      expires_at: "2026-10-13T16:00:00Z",
    };
  };
  replaceStreamUrl(working);
  player.play(TRACKS);
  await settle();
  audio.start(187);
  audio.advance(42);
  replaceStreamUrl((trackId) => {
    requests.push({ track: trackId, quality: "high" });
    return Promise.reject(new ApiFailure(new Response(null, { status: 502 }), null));
  });
  audio.fail(); // the stream breaks; renewing it fails too
  await settle();
  expect(playing()).toBe("A");
  expect(state().playing).toBe(false);
  expect(state().position).toBe(42);

  // Retried only for a track that stopped so: not one paused since.
  replaceStreamUrl(working);
  player.retryStalled();
  await settle();
  expect(playing()).toBe("A");
  expect(audio.src).toBe(`/stream/${A.id}`);
  expect(audio.currentTime).toBe(42);
  expect(audio.paused).toBe(false);
  const asked = requests.length;
  player.pause();
  player.retryStalled();
  await settle();
  expect(requests).toHaveLength(asked);
  expect(audio.paused).toBe(true);
});

test("a single track on repeat all counts each time it is heard", async () => {
  const { audio, player, scrobbles } = setup();
  player.play([A]);
  player.setRepeat("all");
  await settle();
  audio.start(187);
  audio.finish();
  await settle();
  audio.start(187);
  audio.advance(31);
  expect(scrobbles.map((scrobble) => scrobble.track)).toEqual([A.id, A.id]);
});

test("renews an expired stream URL before playing on", async () => {
  const { audio, player, requests, later } = setup();
  player.play([A]);
  await settle();
  audio.start(187);
  audio.advance(60);
  player.pause();
  player.resume();
  expect(requests).toHaveLength(1);
  player.pause();
  later(6 * HOUR);
  player.resume();
  await settle();
  expect(requests).toHaveLength(2);
  expect(audio.src).toContain("n=2");
  expect(audio.currentTime).toBe(60);
});

test("a stream URL that arrives late for a track no longer wanted is dropped", async () => {
  const { audio, player, replaceStreamUrl, playing } = setup();
  const pending: ((url: StreamUrl) => void)[] = [];
  replaceStreamUrl(() => new Promise((resolve) => pending.push(resolve)));
  player.play(TRACKS);
  player.next();
  const url = (id: string): StreamUrl => ({
    url: `/stream/${id}`,
    quality: "high",
    codec: "opus",
    bitrate: 160,
    expires_at: "2026-10-13T16:00:00Z",
  });
  pending[1]!(url(B.id));
  pending[0]!(url(A.id));
  await settle();
  expect(playing()).toBe("B");
  expect(audio.src).toBe(`/stream/${B.id}`);
});

test("autoplay refused by the browser leaves it paused", async () => {
  const { audio, player, state } = setup();
  audio.playResult = () => Promise.reject(new DOMException("click first", "NotAllowedError"));
  player.play([A]);
  await settle();
  expect(state().playing).toBe(false);
});

test("a pause from outside shows as paused; switching tracks doesn't", async () => {
  const { audio, player, state, replaceStreamUrl } = setup();
  player.play(TRACKS);
  await settle();
  audio.start(187);
  // The player pauses the old stream itself, and stays playing while the new one's URL comes.
  let arrive = () => {};
  replaceStreamUrl(
    (trackId) =>
      new Promise((resolve) => {
        arrive = () =>
          resolve({
            url: `/stream/${trackId}`,
            quality: "high",
            codec: "opus",
            bitrate: 160,
            expires_at: "2026-10-13T16:00:00Z",
          });
      }),
  );
  player.next();
  await settle();
  expect(state().playing).toBe(true);
  arrive();
  await settle();
  audio.start(187);
  audio.pause(); // headphones out
  await settle();
  expect(state().playing).toBe(false);
});

test("the old stream's last events don't move the new track", async () => {
  const { audio, player, state } = setup();
  player.play(TRACKS);
  await settle();
  audio.start(187);
  audio.advance(20);
  player.next(); // the old stream pauses: a time update at 20 s follows
  await settle();
  expect(state().position).toBe(0);
  expect(state().playing).toBe(true);
});

test("a new quality applies to the playing track at once", async () => {
  const { audio, player, requests, setQuality } = setup();
  player.play([A]);
  await settle();
  audio.start(187);
  audio.advance(30);
  player.applyQuality();
  expect(requests).toHaveLength(1);
  setQuality("original");
  player.applyQuality();
  await settle();
  expect(requests.at(-1)).toEqual({ track: A.id, quality: "original" });
  expect(audio.currentTime).toBe(30);
  expect(audio.paused).toBe(false);
});

test("a restored queue waits, paused, where it was", async () => {
  const { player, state, requests, playing, audio } = setup();
  const queue = { items: TRACKS.map((t, i) => ({ key: `k${i}`, track: t })), current: 1 };
  player.restore({
    queue: { ...queue, unshuffled: null },
    source: null,
    repeat: "all",
    position: 75,
  });
  expect(playing()).toBe("B");
  expect(state()).toMatchObject({ playing: false, position: 75, repeat: "all", duration: 187 });
  expect(requests).toHaveLength(0);
  player.toggle();
  await settle();
  expect(requests).toHaveLength(1);
  expect(audio.currentTime).toBe(75);
  expect(state().playing).toBe(true);
});

test("queue edits", async () => {
  const { player, state, playing } = setup();
  player.addToQueue([A]);
  expect(playing()).toBe("A");
  expect(state()).toMatchObject({ playing: false, duration: 187 });
  player.addToQueue([B]);
  player.playNext([C]);
  const titles = () => upcoming(state().queue).map((item) => item.track.title);
  expect(titles()).toEqual(["C", "B"]);
  player.remove(upcoming(state().queue)[0]!.key);
  expect(titles()).toEqual(["B"]);
  player.jump(upcoming(state().queue)[0]!.key);
  await settle();
  expect(playing()).toBe("B");
  expect(state().playing).toBe(true);
  player.clearUpcoming();
  expect(state().queue.items).toHaveLength(1);
  player.reset();
  expect(state().queue.items).toHaveLength(0);
});

test("shuffle keeps the mode for the next queue", async () => {
  const { player, state, playing } = setup();
  player.play(TRACKS, { shuffle: true });
  expect(state().queue.unshuffled).not.toBeNull();
  // random() is 0: the first track; then the rest, shuffled.
  expect(playing()).toBe("A");
  player.play(TRACKS, { start: 2 });
  expect(playing()).toBe("C");
  expect(state().queue.unshuffled).not.toBeNull();
  player.setShuffle(false);
  expect(state().queue.items.map((item) => item.track.title)).toEqual(["A", "B", "C"]);
  expect(playing()).toBe("C");
});

test("volume and mute", () => {
  const { audio, player, state } = setup();
  player.setVolume(0.3);
  expect(audio.volume).toBe(0.3);
  player.setMuted(true);
  expect(audio.muted).toBe(true);
  player.setVolume(0);
  player.setMuted(false);
  // Unmuting at zero brings some volume back.
  expect(state()).toMatchObject({ muted: false, volume: 0.5 });
  expect(audio.volume).toBe(0.5);
});
