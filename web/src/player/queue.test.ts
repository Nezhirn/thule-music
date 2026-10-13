import type { Track } from "../catalog/queries";
import { album, track, WIND } from "../test/catalog";
import * as q from "./queue";

const ALBUM = album("Ветер", WIND);
const ALL = ["A", "B", "C", "D", "E"].map((title) => track(title, ALBUM));
const [A, B, C, D] = ALL as [Track, Track, Track, Track, Track];

const titles = (items: q.QueueItem[]) => items.map((item) => item.track.title).join("");
const current = (queue: q.Queue) => q.currentItem(queue)?.track.title;

// Deterministic "random": always picks the lowest index, which reverses the list.
const low = () => 0;

test("a new queue starts at the given track", () => {
  const queue = q.newQueue(ALL, 2, false);
  expect(titles(queue.items)).toBe("ABCDE");
  expect(current(queue)).toBe("C");
  expect(titles(q.upcoming(queue))).toBe("DE");
  expect(q.newQueue([], 0, false).current).toBe(-1);
});

test("shuffling plays the current track first and the others in random order", () => {
  const queue = q.newQueue(ALL, 2, true, low);
  expect(current(queue)).toBe("C");
  expect(queue.current).toBe(0);
  expect(titles(queue.items)).toBe("CBDEA");
  expect(titles(queue.items).split("").sort().join("")).toBe("ABCDE");
});

test("turning shuffle off goes back to the album order at the same track", () => {
  const queue = q.newQueue(ALL, 0, true, low);
  const moved = q.step(queue, 1, false)!; // the second shuffled track
  const back = q.unshuffled(moved);
  expect(titles(back.items)).toBe("ABCDE");
  expect(current(back)).toBe(current(moved));
  expect(back.unshuffled).toBeNull();
});

test("play next goes right after the current track, in the order too", () => {
  const queue = q.newQueue(ALL, 1, true, low);
  const next = q.playNext(queue, [A]);
  expect(titles(q.upcoming(next)).startsWith("A")).toBe(true);
  // Shuffle off later: the added track is still right after the current one.
  const back = q.unshuffled(next);
  expect(current(back)).toBe("B");
  expect(titles(back.items)).toBe("ABACDE");
});

test("tracks added to an empty queue become its current one", () => {
  expect(current(q.playNext(q.EMPTY_QUEUE, [A]))).toBe("A");
  expect(current(q.addToQueue(q.EMPTY_QUEUE, [A, B]))).toBe("A");
});

test("add to queue appends", () => {
  const queue = q.addToQueue(q.newQueue([A, B], 0, false), [C]);
  expect(titles(queue.items)).toBe("ABC");
  expect(current(queue)).toBe("A");
});

test("removing keeps the current track and the other copies of a track", () => {
  const queue = q.playNext(q.newQueue(ALL, 2, false), [A]); // A B C A D E
  const first = queue.items[0]!;
  const removed = q.remove(queue, first.key);
  expect(titles(removed.items)).toBe("BCADE");
  expect(current(removed)).toBe("C");
  // The current one can't be removed.
  expect(q.remove(removed, q.currentItem(removed)!.key)).toBe(removed);
});

test("removing while shuffled removes from both orders", () => {
  const queue = q.newQueue(ALL, 0, true, low);
  const gone = q.upcoming(queue)[0]!;
  const back = q.unshuffled(q.remove(queue, gone.key));
  expect(back.items).toHaveLength(4);
  expect(back.items).not.toContain(gone);
});

test("clearing keeps only the current track", () => {
  const queue = q.clearUpcoming(q.newQueue(ALL, 3, true, low));
  expect(titles(queue.items)).toBe("D");
  expect(titles(q.unshuffled(queue).items)).toBe("D");
});

test("stepping stops at the ends unless wrapping", () => {
  const last = q.newQueue(ALL, 4, false);
  expect(q.step(last, 1, false)).toBeNull();
  expect(current(q.step(last, 1, true)!)).toBe("A");
  const first = q.newQueue(ALL, 0, false);
  expect(q.step(first, -1, false)).toBeNull();
  expect(current(q.step(first, -1, true)!)).toBe("E");
});

test("jumping goes to the item, not to another copy of its track", () => {
  const queue = q.playNext(q.newQueue(ALL, 0, false), [D]); // A D B C D E
  const lastD = queue.items[4]!;
  expect(q.jump(queue, lastD.key)!.current).toBe(4);
  expect(q.jump(queue, "gone")).toBeNull();
});

test("keys are unique", () => {
  const keys = q.addToQueue(q.newQueue(ALL, 0, false), ALL).items.map((item) => item.key);
  expect(new Set(keys).size).toBe(10);
});
