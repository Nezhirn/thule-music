import { storage } from "../lib/storage";
import type { Player, PlayerState, Repeat, Saved, Source } from "./player";
import type { Queue, QueueItem } from "./queue";

// The queue and where it was, for the next start on this device; cleared on signing out.
// The version changes when the saved shape (the API's track included) does: an older save
// is dropped rather than read wrong.
const QUEUE_KEY = "thule.player";
const VERSION = 1;
// The volume is the device's, kept across accounts.
const VOLUME_KEY = "thule.volume";
// The position is saved at most this often while playing (ms), and when the page is hidden.
const POSITION_EVERY = 5000;

const REPEATS: readonly Repeat[] = ["off", "all", "one"];
const SOURCES: readonly Source["type"][] = [
  "album",
  "artist",
  "tracks",
  "liked",
  "playlist",
  "history",
];

function isSource(value: Partial<Source> | null | undefined): value is Source {
  return SOURCES.includes(value?.type as Source["type"]) && typeof value?.id === "string";
}

function isItems(value: unknown): value is QueueItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: Partial<QueueItem> | null) =>
        typeof item?.key === "string" && typeof item.track?.id === "string",
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

export function loadSaved(): Saved | null {
  try {
    const value = JSON.parse(storage.get(QUEUE_KEY) ?? "null") as
      (Partial<Saved> & { v?: number }) | null;
    if (value?.v !== VERSION || !isQueue(value.queue)) return null;
    return {
      queue: value.queue,
      source: isSource(value.source) ? value.source : null,
      repeat: REPEATS.includes(value.repeat as Repeat) ? (value.repeat as Repeat) : "off",
      position: typeof value.position === "number" && value.position > 0 ? value.position : 0,
    };
  } catch {
    return null;
  }
}

function save(state: PlayerState) {
  if (state.queue.items.length === 0) {
    storage.remove(QUEUE_KEY);
    return;
  }
  const saved: Saved & { v: number } = {
    v: VERSION,
    queue: state.queue,
    source: state.source,
    repeat: state.repeat,
    position: state.position,
  };
  storage.set(QUEUE_KEY, JSON.stringify(saved));
}

export function forgetSaved() {
  storage.remove(QUEUE_KEY);
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

/** Saves the player's queue and volume as they change. Returns the unsubscribe. */
export function keepSaved(player: Player, now: () => number = Date.now): () => void {
  let savedAt = 0;
  const flush = () => {
    savedAt = now();
    save(player.store.getState());
  };
  const unsubscribe = player.store.subscribe((state, previous) => {
    if (state.volume !== previous.volume || state.muted !== previous.muted) {
      storage.set(VOLUME_KEY, JSON.stringify({ volume: state.volume, muted: state.muted }));
    }
    if (
      state.queue !== previous.queue ||
      state.source !== previous.source ||
      state.repeat !== previous.repeat ||
      // Paused or seeked: where to come back to.
      (state.position !== previous.position &&
        (!state.playing || now() - savedAt >= POSITION_EVERY))
    ) {
      flush();
    }
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);
  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
  };
}
