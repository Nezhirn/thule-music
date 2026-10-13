import type { Track } from "../catalog/queries";

/** A track in the queue. The same track can be queued twice: the key tells them apart. */
export interface QueueItem {
  key: string;
  track: Track;
}

export interface Queue {
  /** In the order they play. */
  items: QueueItem[];
  /** The index of the playing (or paused) item; -1 when the queue is empty. */
  current: number;
  /** While shuffled: the same items in the order they came, to go back to. */
  unshuffled: QueueItem[] | null;
}

export const EMPTY_QUEUE: Queue = { items: [], current: -1, unshuffled: null };

// Keys are unique within a page load by the counter, and against keys restored from an
// earlier one by the prefix. Not crypto.randomUUID: it is missing on plain HTTP, which a home
// server may well use.
const prefix = Math.random().toString(36).slice(2, 8);
let counter = 0;

function toItems(tracks: Track[]): QueueItem[] {
  return tracks.map((track) => ({ key: `${prefix}-${(counter++).toString(36)}`, track }));
}

export function currentItem(queue: Queue): QueueItem | null {
  return queue.items[queue.current] ?? null;
}

/** What plays after the current item, in order. */
export function upcoming(queue: Queue): QueueItem[] {
  return queue.items.slice(queue.current + 1);
}

/** A new queue of `tracks`, at `start`; shuffled, it plays `start` first. */
export function newQueue(
  tracks: Track[],
  start: number,
  shuffle: boolean,
  random: () => number = Math.random,
): Queue {
  const queue: Queue = {
    items: toItems(tracks),
    current: tracks.length ? Math.min(Math.max(start, 0), tracks.length - 1) : -1,
    unshuffled: null,
  };
  return shuffle ? shuffled(queue, random) : queue;
}

/** The current item first, the others in random order after it. */
export function shuffled(queue: Queue, random: () => number = Math.random): Queue {
  if (queue.unshuffled) return queue;
  const current = currentItem(queue);
  const rest = queue.items.filter((item) => item !== current);
  // Fisher–Yates.
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return {
    items: current ? [current, ...rest] : rest,
    current: current ? 0 : -1,
    unshuffled: queue.items,
  };
}

/** Back to the order the items came in, at the same current item. */
export function unshuffled(queue: Queue): Queue {
  if (!queue.unshuffled) return queue;
  const key = currentItem(queue)?.key;
  return {
    items: queue.unshuffled,
    current: queue.unshuffled.findIndex((item) => item.key === key),
    unshuffled: null,
  };
}

/** Puts `items` right after `key` (at the start for null). */
function insertAfter(list: QueueItem[], key: string | undefined, items: QueueItem[]) {
  const at = key === undefined ? 0 : list.findIndex((item) => item.key === key) + 1;
  return [...list.slice(0, at), ...items, ...list.slice(at)];
}

/** Queues `tracks` to play right after the current item. In an empty queue they become it. */
export function playNext(queue: Queue, tracks: Track[]): Queue {
  const added = toItems(tracks);
  if (added.length === 0) return queue;
  const key = currentItem(queue)?.key;
  return {
    items: insertAfter(queue.items, key, added),
    current: Math.max(queue.current, 0),
    unshuffled: queue.unshuffled && insertAfter(queue.unshuffled, key, added),
  };
}

/** Queues `tracks` at the end. */
export function addToQueue(queue: Queue, tracks: Track[]): Queue {
  const added = toItems(tracks);
  if (added.length === 0) return queue;
  return {
    items: [...queue.items, ...added],
    current: Math.max(queue.current, 0),
    unshuffled: queue.unshuffled && [...queue.unshuffled, ...added],
  };
}

/** Takes an item out of the queue; the current one stays. */
export function remove(queue: Queue, key: string): Queue {
  const index = queue.items.findIndex((item) => item.key === key);
  if (index === -1 || index === queue.current) return queue;
  return {
    items: queue.items.filter((item) => item.key !== key),
    current: index < queue.current ? queue.current - 1 : queue.current,
    unshuffled: queue.unshuffled && queue.unshuffled.filter((item) => item.key !== key),
  };
}

/** Everything but the current item. */
export function clearUpcoming(queue: Queue): Queue {
  const current = currentItem(queue);
  if (!current) return EMPTY_QUEUE;
  return { items: [current], current: 0, unshuffled: queue.unshuffled && [current] };
}

/** The queue at the item with `key`, or null if it is gone. */
export function jump(queue: Queue, key: string): Queue | null {
  const index = queue.items.findIndex((item) => item.key === key);
  return index === -1 ? null : { ...queue, current: index };
}

/** The queue one item on (`1`) or back (`-1`); round the ends with `wrap`. Null past an end. */
export function step(queue: Queue, by: 1 | -1, wrap: boolean): Queue | null {
  const count = queue.items.length;
  if (count === 0) return null;
  const index = queue.current + by;
  if (index >= 0 && index < count) return { ...queue, current: index };
  return wrap ? { ...queue, current: (index + count) % count } : null;
}
