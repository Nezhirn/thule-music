import { createStore, type StoreApi } from "zustand/vanilla";
import type { Schemas } from "../api/client";
import { ApiFailure } from "../api/errors";
import type { Track } from "../catalog/queries";
import * as queue from "./queue";
import { EMPTY_QUEUE, currentItem, type Queue, type QueueItem } from "./queue";

export type Quality = Schemas["Quality"];
export type StreamUrl = Schemas["StreamUrl"];
export type Repeat = "off" | "all" | "one";

/** What the queue was started from, to show its play button as playing. */
export interface Source {
  type: "album" | "artist" | "tracks" | "liked" | "playlist" | "history" | "search" | "track";
  id: string;
}

export interface PlayerState {
  queue: Queue;
  source: Source | null;
  /** Playing, or about to (the stream is on its way). */
  playing: boolean;
  /** Waiting for audio data. */
  buffering: boolean;
  /** Seconds into the current track. */
  position: number;
  /** Seconds. The track's length from its tags until the stream reports its own. */
  duration: number;
  repeat: Repeat;
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** What the current stream is: quality, codec, bitrate. */
  stream: Pick<StreamUrl, "quality" | "codec" | "bitrate"> | null;
  /** The track that last failed to play, until another one plays. */
  failed: Track | null;
}

/** The parts of an <audio> element the player uses; tests pass a fake. */
export type AudioLike = Pick<
  HTMLAudioElement,
  | "src"
  | "currentTime"
  | "duration"
  | "paused"
  | "ended"
  | "volume"
  | "muted"
  | "preload"
  | "play"
  | "pause"
  | "canPlayType"
  | "removeAttribute"
  | "load"
  | "addEventListener"
  | "removeEventListener"
>;

/** What the player keeps on the device: the queue survives a reload. */
export interface Saved {
  queue: Queue;
  source: Source | null;
  repeat: Repeat;
  position: number;
}

export interface Deps {
  audio: AudioLike;
  streamUrl(trackId: string, quality: Quality): Promise<StreamUrl>;
  /** Records a play of the track (scrobble), started at `playedAt` (ISO). */
  scrobble(trackId: string, listenedMs: number, playedAt: string): Promise<void>;
  /** The quality the user picked. */
  quality(): Quality;
  now?(): number;
  random?(): number;
}

export interface PlayOptions {
  /** The index of the track to start at; random when shuffling without one. */
  start?: number;
  /** Turn shuffle on (true) or off (false); unchanged when left out. */
  shuffle?: boolean;
  source?: Source | null;
}

export interface Player {
  store: StoreApi<PlayerState>;
  /** Replaces the queue with `tracks` and plays. */
  play(tracks: Track[], options?: PlayOptions): void;
  resume(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(seconds: number): void;
  /** Plays the queued item with `key`. */
  jump(key: string): void;
  playNext(tracks: Track[]): void;
  addToQueue(tracks: Track[]): void;
  remove(key: string): void;
  clearUpcoming(): void;
  /** Changes a queued track (its like), so the queue kept on the device has it too. */
  updateTrack(id: string, change: Partial<Track>): void;
  /** Changes the queued tracks `change` picks (null: not this one): an album's new cover. */
  updateTracks(change: (track: Track) => Partial<Track> | null): void;
  /** Takes tracks deleted from the library out of the queue (the playing one plays on). */
  removeTracks(ids: string[]): void;
  setShuffle(on: boolean): void;
  setRepeat(repeat: Repeat): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Plays the current track at the chosen quality, if it isn't already. */
  applyQuality(): void;
  /** Plays on if a track stopped because the server couldn't be reached while it played
   * (the connection is back). */
  retryStalled(): void;
  /** Restores a saved queue, paused. */
  restore(saved: Saved): void;
  /** Stops and empties the queue (signing out). */
  reset(): void;
  dispose(): void;
}

/** A play counts (is scrobbled) after this much listening, or half the track if shorter. */
export const SCROBBLE_AFTER = 30;
/** "Previous" past this many seconds into a track starts it over instead. */
export const RESTART_AFTER = 3;
/** A stream URL this close to expiring is renewed before playing on (ms). */
const EXPIRY_MARGIN = 60_000;
/** Tracks that fail in a row before the player gives up skipping. */
const MAX_FAILURES = 3;
/** Answers that say the track itself can't be played: it is skipped. Any other (the server
 * restarting behind its proxy, busy, a session to renew) is the server's, for now: the
 * player stops at the track and plays on when asked, or when the connection is back. */
const UNPLAYABLE = new Set(["track_not_found", "audio_file_missing"]);
/** Larger jumps of the playhead between time updates are seeks, not listening. */
const MAX_TICK = 2;

const OPUS = 'audio/ogg; codecs="opus"';

export const INITIAL_STATE: PlayerState = {
  queue: EMPTY_QUEUE,
  source: null,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  repeat: "off",
  volume: 1,
  muted: false,
  stream: null,
  failed: null,
};

export function createPlayer(deps: Deps): Player {
  const { audio } = deps;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const store = createStore<PlayerState>(() => INITIAL_STATE);
  const get = store.getState;
  const set = store.setState;
  // Transcodes are Ogg Opus; a browser that can't play it gets the original file.
  const opus = audio.canPlayType(OPUS) !== "";

  // The stream on the element: which item, until when its URL is valid, at what quality.
  let loaded: { key: string; expiresAt: number; quality: Quality } | null = null;
  // Each load gets a number; a stream URL arriving for an older one is dropped.
  let loads = 0;
  // The item whose stream was already reloaded after an error.
  let retried: string | null = null;
  let failures = 0;
  // Pauses the player makes itself while switching tracks: not the user's.
  let ownPause = false;
  // Listening to the current item, for the scrobble: since when (ms), for how long.
  let listen = { key: "", seconds: 0, at: 0, scrobbled: false, since: 0 };
  // The item that stopped for want of the server while playing (see retryStalled).
  let stalled: string | null = null;
  // The next item's stream URL, asked for while the current one plays: the next track then
  // starts at once, within the "ended" event (which phones require to keep playing). `url`
  // once it came; null until then, or if it didn't (asked again when it is its turn).
  let prefetched: {
    trackId: string;
    quality: Quality;
    url: StreamUrl | null;
    pending: Promise<StreamUrl | null>;
  } | null = null;

  audio.preload = "auto";

  const current = () => currentItem(get().queue);
  // Whether the element holds the current item's stream: events of an old one are ignored.
  const live = () => loaded !== null && loaded.key === current()?.key;
  const wanted = (): Quality => (opus ? deps.quality() : "original");

  function silence() {
    if (audio.paused) return;
    ownPause = true;
    audio.pause();
  }

  function startListening(key: string, at: number) {
    listen = { key, seconds: 0, at, scrobbled: false, since: now() };
  }

  /** The prefetched URL for this track and quality: at once if it came, or on its way. */
  function takePrefetched(trackId: string, quality: Quality) {
    const found = prefetched;
    if (!found || found.trackId !== trackId || found.quality !== quality) return null;
    prefetched = null;
    return found.url ?? found.pending;
  }

  /** The URL if it is still good for a while. */
  const fresh = (url: StreamUrl | null) =>
    url && Date.parse(url.expires_at) - EXPIRY_MARGIN > now() ? url : null;

  function prefetchNext() {
    const { queue: q, repeat } = get();
    if (repeat === "one") return;
    const next = currentItem(queue.step(q, 1, repeat === "all") ?? EMPTY_QUEUE);
    const quality = wanted();
    if (!next || (prefetched?.trackId === next.track.id && prefetched.quality === quality)) {
      return;
    }
    const entry: NonNullable<typeof prefetched> = {
      trackId: next.track.id,
      quality,
      url: null,
      pending: deps.streamUrl(next.track.id, quality).then(
        (url) => (entry.url = url),
        () => null,
      ),
    };
    prefetched = entry;
  }

  async function load(item: QueueItem, at: number, autoplay: boolean) {
    const id = ++loads;
    loaded = null;
    stalled = null;
    silence();
    if (listen.key !== item.key) startListening(item.key, at);
    set({
      playing: autoplay,
      buffering: autoplay,
      position: at,
      duration: item.track.duration_ms / 1000,
      stream: null,
    });
    const quality = wanted();
    const early = takePrefetched(item.track.id, quality);
    let url = fresh(early instanceof Promise ? await early : early);
    if (id !== loads) return;
    if (!url) {
      try {
        url = await deps.streamUrl(item.track.id, quality);
      } catch (error) {
        if (id !== loads) return;
        // Only an answer that the track can't be played skips it. No answer (offline, the
        // page being reloaded or left) or the server's trouble stops at it instead: the
        // queue isn't skipped through, nor its place lost.
        if (error instanceof ApiFailure && error.code && UNPLAYABLE.has(error.code)) {
          fail(item);
        } else {
          stall(item, autoplay);
        }
        return;
      }
    }
    if (id !== loads) return;
    loaded = { key: item.key, expiresAt: Date.parse(url.expires_at), quality };
    audio.src = url.url;
    // A new source drops the element's pending events, the pause from silence() among them.
    ownPause = false;
    // Before the metadata loads this sets where playback starts.
    if (at > 0) audio.currentTime = at;
    listen.at = at;
    set({ stream: { quality: url.quality, codec: url.codec, bitrate: url.bitrate } });
    if (autoplay) start();
  }

  function start() {
    set({ playing: true });
    audio.play().catch((error: unknown) => {
      // A newer stream replaced this one, or the element reports the error itself.
      const name = error instanceof DOMException ? error.name : "";
      if (name === "AbortError" || name === "NotSupportedError") return;
      // NotAllowedError: the browser wants a click first.
      set({ playing: false, buffering: false });
    });
  }

  /** Plays the current item from `position`, loading or renewing its stream as needed. */
  function resume() {
    const item = current();
    if (!item) return;
    if (!loaded || loaded.key !== item.key || now() > loaded.expiresAt - EXPIRY_MARGIN) {
      void load(item, get().position, true);
      return;
    }
    start();
  }

  function pause() {
    // A stream on its way is dropped when it arrives: paused means paused. Play loads it
    // again, from the same place.
    if (loaded === null) loads += 1;
    stalled = null;
    set({ playing: false, buffering: false });
    audio.pause();
  }

  /** Moves to `next` (a queue at another item) and plays it from the start. */
  function go(next: Queue) {
    set({ queue: next });
    const item = currentItem(next);
    if (item) void load(item, 0, true);
  }

  function seek(seconds: number) {
    const { duration } = get();
    const to = Math.min(Math.max(seconds, 0), duration || seconds);
    set({ position: to });
    if (live()) audio.currentTime = to;
  }

  function fail(item: QueueItem) {
    failures += 1;
    const wasPlaying = get().playing;
    set({ failed: item.track, buffering: false });
    const next = queue.step(get().queue, 1, false);
    if (wasPlaying && next && failures < MAX_FAILURES) {
      go(next);
    } else {
      loaded = null;
      set({ playing: false });
    }
  }

  /** Stops at `item`, which couldn't be loaded for now; playing again retries it, and so
   * does the connection coming back if it was playing. */
  function stall(item: QueueItem, wasPlaying: boolean) {
    loaded = null;
    stalled = wasPlaying ? item.key : null;
    set({ playing: false, buffering: false, failed: item.track });
  }

  function onError() {
    const item = current();
    if (!item || loaded?.key !== item.key) return; // an old stream
    if (retried !== item.key) {
      // Most likely the URL expired (a long pause) or the file changed: renew it once.
      retried = item.key;
      void load(item, audio.currentTime || get().position, get().playing);
      return;
    }
    fail(item);
  }

  function onEnded() {
    const { repeat, queue: q } = get();
    const item = current();
    if (repeat === "one" && item) {
      startListening(item.key, 0);
      audio.currentTime = 0;
      start();
      return;
    }
    const next = queue.step(q, 1, repeat === "all");
    if (next) {
      // Heard to the end: the next item is a new listen, even the same one again (a queue of
      // one track on repeat all).
      listen.key = "";
      go(next);
      return;
    }
    // The end: back to the first track, stopped, ready to play it all again.
    const first = { ...q, current: 0 };
    loaded = null;
    listen.key = "";
    set({
      queue: first,
      playing: false,
      buffering: false,
      position: 0,
      duration: (currentItem(first)?.track.duration_ms ?? 0) / 1000,
    });
  }

  function onTimeUpdate() {
    if (!live()) return;
    const time = audio.currentTime;
    const tick = time - listen.at;
    listen.at = time;
    const item = current();
    if (item?.key === listen.key && !audio.paused && tick > 0 && tick < MAX_TICK) {
      listen.seconds += tick;
      const length = item.track.duration_ms / 1000 || get().duration;
      const threshold = length > 0 ? Math.min(SCROBBLE_AFTER, length / 2) : SCROBBLE_AFTER;
      if (!listen.scrobbled && listen.seconds >= threshold) {
        listen.scrobbled = true;
        const playedAt = new Date(listen.since).toISOString();
        deps.scrobble(item.track.id, Math.round(listen.seconds * 1000), playedAt).catch(() => {});
      }
      // The queue may have changed since the track started: what comes next now.
      prefetchNext();
    }
    set({ position: time });
  }

  const handlers: Record<string, () => void> = {
    play: () => set({ playing: true }),
    pause: () => {
      if (ownPause) {
        ownPause = false;
        return;
      }
      // Paused from outside: the system, another app taking the audio, headphones out.
      if (!audio.ended) set({ playing: false, buffering: false });
    },
    playing: () => {
      failures = 0;
      retried = null;
      set({ buffering: false, failed: null });
    },
    waiting: () => {
      if (live()) set({ buffering: true });
    },
    timeupdate: onTimeUpdate,
    seeked: () => {
      if (!live()) return;
      listen.at = audio.currentTime;
      set({ position: audio.currentTime });
    },
    durationchange: () => {
      if (live() && Number.isFinite(audio.duration) && audio.duration > 0) {
        set({ duration: audio.duration });
      }
    },
    ended: onEnded,
    error: onError,
  };
  for (const [event, handler] of Object.entries(handlers)) audio.addEventListener(event, handler);

  function applyVolume() {
    const { volume, muted } = get();
    audio.volume = volume;
    audio.muted = muted;
  }

  function reset() {
    loads += 1;
    loaded = null;
    stalled = null;
    prefetched = null;
    silence();
    audio.removeAttribute("src");
    audio.load();
    ownPause = false;
    listen.key = "";
    const { volume, muted } = get();
    set({ ...INITIAL_STATE, volume, muted });
  }

  return {
    store,
    play(tracks, options = {}) {
      if (tracks.length === 0) return;
      const shuffle = options.shuffle ?? get().queue.unshuffled !== null;
      const start = options.start ?? (shuffle ? Math.floor(random() * tracks.length) : 0);
      set({ source: options.source ?? null, failed: null });
      failures = 0;
      go(queue.newQueue(tracks, start, shuffle, random));
    },
    resume,
    pause,
    toggle() {
      if (get().playing) pause();
      else resume();
    },
    next() {
      const next = queue.step(get().queue, 1, get().repeat !== "off");
      if (next) go(next);
    },
    previous() {
      const { queue: q, position, repeat } = get();
      const back = position <= RESTART_AFTER ? queue.step(q, -1, repeat !== "off") : null;
      if (back) {
        go(back);
        return;
      }
      seek(0);
      if (!get().playing) resume();
    },
    seek,
    jump(key) {
      const next = queue.jump(get().queue, key);
      if (next) go(next);
    },
    playNext(tracks) {
      const wasEmpty = !current();
      set({ queue: queue.playNext(get().queue, tracks) });
      if (wasEmpty) set({ position: 0, duration: (current()?.track.duration_ms ?? 0) / 1000 });
    },
    addToQueue(tracks) {
      const wasEmpty = !current();
      set({ queue: queue.addToQueue(get().queue, tracks) });
      if (wasEmpty) set({ position: 0, duration: (current()?.track.duration_ms ?? 0) / 1000 });
    },
    remove(key) {
      set({ queue: queue.remove(get().queue, key) });
    },
    clearUpcoming() {
      set({ queue: queue.clearUpcoming(get().queue) });
    },
    updateTrack(id, change) {
      const updated = queue.updateTrack(get().queue, id, change);
      if (updated !== get().queue) set({ queue: updated });
    },
    updateTracks(change) {
      const updated = queue.updateTracks(get().queue, change);
      if (updated !== get().queue) set({ queue: updated });
    },
    removeTracks(ids) {
      const updated = queue.removeTracks(get().queue, new Set(ids));
      if (updated !== get().queue) set({ queue: updated });
    },
    setShuffle(on) {
      const q = get().queue;
      set({ queue: on ? queue.shuffled(q, random) : queue.unshuffled(q) });
    },
    setRepeat(repeat) {
      set({ repeat });
    },
    setVolume(volume) {
      set({ volume: Math.min(Math.max(volume, 0), 1), muted: volume <= 0 });
      applyVolume();
    },
    setMuted(muted) {
      // Unmuting at zero volume would still be silent.
      set(muted || get().volume > 0 ? { muted } : { muted, volume: 0.5 });
      applyVolume();
    },
    applyQuality() {
      const item = current();
      if (item && live() && loaded?.quality !== wanted()) {
        void load(item, audio.currentTime, get().playing);
      }
    },
    retryStalled() {
      if (stalled !== null && stalled === current()?.key) resume();
    },
    restore(saved) {
      const item = currentItem(saved.queue);
      set({
        queue: saved.queue,
        source: saved.source,
        repeat: saved.repeat,
        position: item ? saved.position : 0,
        duration: (item?.track.duration_ms ?? 0) / 1000,
      });
    },
    reset,
    dispose() {
      for (const [event, handler] of Object.entries(handlers)) {
        audio.removeEventListener(event, handler);
      }
      reset();
    },
  };
}
