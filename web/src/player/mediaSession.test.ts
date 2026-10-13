import type { Track } from "../catalog/queries";
import { FakeAudio } from "../test/audio";
import { album, ANNA, track, WIND } from "../test/catalog";
import { connectMediaSession } from "./mediaSession";
import { createPlayer } from "./player";

const ALBUM = album("Ветер", WIND);
const TRACKS = [track("A", ALBUM, [WIND, ANNA]), track("B", ALBUM)];

class FakeMetadata {
  constructor(init: MediaMetadataInit) {
    Object.assign(this, init);
  }
}

function setup() {
  vi.stubGlobal("MediaMetadata", FakeMetadata);
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  const session = {
    metadata: null as MediaMetadata | null,
    playbackState: "none" as MediaSessionPlaybackState,
    positions: [] as MediaPositionState[],
    setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
      if (action === "stop") throw new TypeError("not supported here");
      handlers.set(action, handler);
    },
    setPositionState(state: MediaPositionState) {
      this.positions.push(state);
    },
  };
  const audio = new FakeAudio();
  const player = createPlayer({
    audio: audio.asAudio(),
    streamUrl: async () => ({
      url: "/stream",
      quality: "high",
      codec: "opus",
      bitrate: 160,
      expires_at: "2026-10-13T16:00:00Z",
    }),
    scrobble: async () => {},
    quality: () => "high",
  });
  const disconnect = connectMediaSession(player, session as unknown as MediaSession);
  const action = (name: string, details: Partial<MediaSessionActionDetails> = {}) =>
    handlers.get(name)!({ action: name as MediaSessionAction, ...details });
  return { session, handlers, player, audio, action, disconnect };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

test("tells the system what plays", async () => {
  const { session, player, audio } = setup();
  player.play(TRACKS);
  expect(session.metadata).toMatchObject({
    title: "A",
    artist: "Северный Ветер, Анна Лунина",
    album: "Ветер",
  });
  const artwork = (session.metadata as unknown as MediaMetadataInit).artwork!;
  expect(artwork.map((a) => a.sizes)).toEqual(["300x300", "600x600"]);
  expect(artwork[0]!.src).toBe(`${location.origin}/api/v1/covers/${ALBUM.cover_id}?size=300`);
  expect(session.playbackState).toBe("playing");
  await settle();
  audio.start(180);
  expect(session.positions.at(-1)).toEqual({ duration: 180, position: 0, playbackRate: 1 });
  player.pause();
  expect(session.playbackState).toBe("paused");
});

test("takes the system's commands", async () => {
  const { player, action, audio } = setup();
  player.play(TRACKS);
  await settle();
  audio.start(180);
  action("pause");
  expect(player.store.getState().playing).toBe(false);
  action("play");
  expect(player.store.getState().playing).toBe(true);
  action("seekto", { seekTime: 100 });
  expect(audio.currentTime).toBe(100);
  action("seekbackward");
  expect(audio.currentTime).toBe(90);
  action("seekforward", { seekOffset: 30 });
  expect(audio.currentTime).toBe(120);
  action("nexttrack");
  expect(player.store.getState().queue.current).toBe(1);
});

test("shows a queue that was there before it connected", () => {
  vi.stubGlobal("MediaMetadata", FakeMetadata);
  const audio = new FakeAudio();
  const player = createPlayer({
    audio: audio.asAudio(),
    streamUrl: () => new Promise(() => {}),
    scrobble: async () => {},
    quality: () => "high",
  });
  player.restore({
    queue: { items: [{ key: "a", track: TRACKS[1]! }], current: 0, unshuffled: null },
    source: null,
    repeat: "off",
    position: 30,
  });
  const session = { setActionHandler() {}, setPositionState() {} } as unknown as MediaSession;
  connectMediaSession(player, session);
  expect(session.metadata).toMatchObject({ title: "B" });
  expect(session.playbackState).toBe("paused");
});

test("lets go when disconnected", () => {
  const { session, handlers, player, disconnect } = setup();
  player.play(TRACKS as Track[]);
  disconnect();
  expect(session.metadata).toBeNull();
  expect([...handlers.values()].every((handler) => handler === null)).toBe(true);
});
