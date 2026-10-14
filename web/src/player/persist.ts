import { storage } from "../lib/storage";
import type { Player, PlayerState, Repeat, Saved, Source } from "./player";
import type { Queue, QueueItem } from "./queue";

// The queue and where it was, for the next start on this device; cleared on signing out.
// The version changes when the saved shape (the API's track included) does: an older save
// is dropped rather than read wrong.
const QUEUE_KEY = "thule.player";
const VERSION = 3;
// Where in the current track, saved apart: it changes every few seconds, the queue (which
// can be megabytes) only when it does.
const POSITION_KEY = "thule.player.position";
// The volume is the device's, kept across accounts.
const VOLUME_KEY = "thule.volume";
// The position is saved at most this often while playing (ms), and when the page is hidden.
const POSITION_EVERY = 5000;
// A queue too big for the browser's storage is saved as this many tracks around the current
// one: better than an older queue coming back.
const SHORTER_QUEUE = 500;

const REPEATS: readonly Repeat[] = ["off", "all", "one"];
const SOURCES: readonly Source["type"][] = [
  "album",
  "artist",
  "tracks",
  "liked",
  "playlist",
  "history",
  "search",
  "track",
];

function isSource(value: Partial<Source> | null | undefined): value is Source {
  return SOURCES.includes(value?.type as Source["type"]) && typeof value?.id === "string";
}

const isRef = (value: unknown) =>
  typeof (value as { id?: unknown } | null)?.id === "string" &&
  typeof (value as { name?: unknown }).name === "string";

/** A track as the player and the pages show it: what a release changing the API's track
 * without a new VERSION would break shows here, not as a blank page on every start. */
function isTrack(value: unknown): boolean {
  const track = value as Record<string, unknown> | null;
  const album = track?.album as Record<string, unknown> | undefined;
  return (
    typeof track?.id === "string" &&
    typeof track.title === "string" &&
    typeof track.duration_ms === "number" &&
    isRef(track.artist) &&
    isRef(track.album_artist) &&
    Array.isArray(track.artists) &&
    track.artists.every(isRef) &&
    typeof album?.id === "string" &&
    typeof album.title === "string"
  );
}

function isItems(value: unknown): value is QueueItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: Partial<QueueItem> | null) => typeof item?.key === "string" && isTrack(item.track),
    )
  );
}

function isQueue(value: Partial<Queue> | undefined): value is Queue {
  if (!value || !isItems(value.items)) return false;
  const { items, current, unshuffled } = value;
  return (
    Number.isInteger(current) &&
    current! >= (items.length ? 0 : -1) &&
    current! < items.length &&
    (unshuffled === null || (isItems(unshuffled) && unshuffled.length === items.length))
  );
}

/** As saved: the order to go back to after shuffling as keys of the items, not the items
 * again (which doubled the size). */
interface StoredQueue {
  items: QueueItem[];
  current: number;
  unshuffled: string[] | null;
}

function toStored(queue: Queue): StoredQueue {
  return { ...queue, unshuffled: queue.unshuffled?.map((item) => item.key) ?? null };
}

function fromStored(stored: Partial<StoredQueue> | undefined): Queue | undefined {
  if (!stored || !Array.isArray(stored.items)) return undefined;
  const byKey = new Map(stored.items.map((item) => [item?.key, item]));
  const order = stored.unshuffled;
  const unshuffled = Array.isArray(order) ? order.map((key) => byKey.get(key)) : null;
  if (unshuffled?.some((item) => !item)) return undefined;
  return { items: stored.items, current: stored.current!, unshuffled: unshuffled as QueueItem[] };
}

/** A version 1 save: its tracks had no picture of their own, they showed their album's. */
function fromVersion1(queue: Queue): Queue {
  const upgrade = (items: QueueItem[]) =>
    items.map((item) => ({
      ...item,
      track: {
        ...item.track,
        cover_id: item.track.album.cover_id,
        cover_palette: item.track.album.cover_palette,
      },
    }));
  return {
    ...queue,
    items: upgrade(queue.items),
    unshuffled: queue.unshuffled && upgrade(queue.unshuffled),
  };
}

export function loadSaved(): Saved | null {
  try {
    const value = JSON.parse(storage.get(QUEUE_KEY) ?? "null") as
      (Partial<Omit<Saved, "queue">> & { v?: number; queue?: unknown }) | null;
    let queue: Queue | undefined;
    if (value?.v === VERSION) queue = fromStored(value.queue as Partial<StoredQueue>);
    // Versions 1 and 2 kept the shuffled-from order as items, and the position with them.
    else if (value?.v === 2 || value?.v === 1) queue = value.queue as Queue;
    if (value?.v === 1 && isQueue(queue)) queue = fromVersion1(queue);
    if (!value || !isQueue(queue)) return null;
    const current = queue.items[queue.current];
    return {
      queue,
      source: isSource(value.source) ? value.source : null,
      repeat: REPEATS.includes(value.repeat as Repeat) ? (value.repeat as Repeat) : "off",
      position: value.v === VERSION ? loadPosition(current?.key) : positive(value.position),
    };
  } catch {
    return null;
  }
}

function positive(value: unknown): number {
  return typeof value === "number" && value > 0 ? value : 0;
}

function loadPosition(key: string | undefined): number {
  try {
    const value = JSON.parse(storage.get(POSITION_KEY) ?? "null") as {
      key?: unknown;
      position?: unknown;
    } | null;
    return value?.key === key ? positive(value?.position) : 0;
  } catch {
    return 0;
  }
}

function saveQueue(state: PlayerState) {
  const { queue } = state;
  if (queue.items.length === 0) {
    forgetSaved();
    return;
  }
  const saved = (stored: StoredQueue) =>
    JSON.stringify({ v: VERSION, queue: stored, source: state.source, repeat: state.repeat });
  if (storage.set(QUEUE_KEY, saved(toStored(queue)))) return;
  // Too big for the browser's storage: the tracks around the current one, unshuffled.
  const from = Math.max(queue.current - SHORTER_QUEUE / 10, 0);
  storage.set(
    QUEUE_KEY,
    saved({
      items: queue.items.slice(from, from + SHORTER_QUEUE),
      current: queue.current - from,
      unshuffled: null,
    }),
  );
}

function savePosition(state: PlayerState) {
  const key = state.queue.items[state.queue.current]?.key;
  if (key) storage.set(POSITION_KEY, JSON.stringify({ key, position: state.position }));
}

export function forgetSaved() {
  storage.remove(QUEUE_KEY);
  storage.remove(POSITION_KEY);
}

export function loadVolume(): { volume: number; muted: boolean } | null {
  try {
    const value = JSON.parse(storage.get(VOLUME_KEY) ?? "null") as {
      volume?: unknown;
      muted?: unknown;
    } | null;
    if (typeof value?.volume !== "number" || typeof value.muted !== "boolean") return null;
    return { volume: Math.min(Math.max(value.volume, 0), 1), muted: value.muted };
  } catch {
    return null;
  }
}

/** Saves the player's queue, position and volume as they change. Only what this page
 * changed: another tab's newer queue isn't written over when this one is hidden or closed.
 * Returns the unsubscribe. */
export function keepSaved(player: Player, now: () => number = Date.now): () => void {
  let savedAt = 0;
  let positionChanged = false;
  const flushPosition = () => {
    if (!positionChanged) return;
    positionChanged = false;
    savedAt = now();
    savePosition(player.store.getState());
  };
  const unsubscribe = player.store.subscribe((state, previous) => {
    if (state.volume !== previous.volume || state.muted !== previous.muted) {
      storage.set(VOLUME_KEY, JSON.stringify({ volume: state.volume, muted: state.muted }));
    }
    if (
      state.queue !== previous.queue ||
      state.source !== previous.source ||
      state.repeat !== previous.repeat
    ) {
      saveQueue(state);
      positionChanged = true;
    }
    if (state.position !== previous.position) positionChanged = true;
    // Paused or seeked: where to come back to; while playing, every few seconds.
    if (positionChanged && (!state.playing || now() - savedAt >= POSITION_EVERY)) {
      flushPosition();
    }
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") flushPosition();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flushPosition);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flushPosition);
  };
}
