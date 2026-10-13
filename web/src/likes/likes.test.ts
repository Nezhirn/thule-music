import { createLikes, type LikeKind } from "./likes";

/** A server whose answers the test releases one by one. */
function setup() {
  const requests: { liked: boolean; resolve(): void; reject(error: Error): void }[] = [];
  const changes: string[] = [];
  const saved: string[] = [];
  const likes = createLikes({
    send: (_kind, _id, liked) =>
      new Promise<void>((resolve, reject) => requests.push({ liked, resolve, reject })),
    changed: (kind, id, liked) => changes.push(`${kind} ${id} ${liked}`),
    saved: (kind, id, liked) => saved.push(`${kind} ${id} ${liked}`),
  });
  const shown = (kind: LikeKind, id: string) => likes.store.getState()[kind][id];
  return { likes, requests, changes, saved, shown };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

test("a like shows at once and is saved", async () => {
  const { likes, requests, changes, saved, shown } = setup();
  const done = likes.set("track", "t1", true, false);
  expect(shown("track", "t1")).toBe(true);
  expect(changes).toEqual(["track t1 true"]);
  await flush();
  requests[0]!.resolve();
  await done;
  expect(saved).toEqual(["track t1 true"]);
});

test("changes of one item reach the server one after another, in order", async () => {
  const { likes, requests, shown } = setup();
  const first = likes.set("album", "a1", true, false);
  const second = likes.set("album", "a1", false, true);
  await flush();
  // The unlike waits for the like: otherwise the server could get them the other way round.
  expect(requests.map((r) => r.liked)).toEqual([true]);
  requests[0]!.resolve();
  await first;
  await flush();
  expect(requests.map((r) => r.liked)).toEqual([true, false]);
  requests[1]!.resolve();
  await second;
  expect(shown("album", "a1")).toBe(false);
});

test("a refused change is put back, unless it was changed again meanwhile", async () => {
  const { likes, requests, shown } = setup();
  const refused = likes.set("artist", "r1", true, false);
  await flush();
  requests[0]!.reject(new Error("offline"));
  await expect(refused).rejects.toThrow("offline");
  expect(shown("artist", "r1")).toBe(false);

  const like = likes.set("artist", "r1", true, false);
  const unlike = likes.set("artist", "r1", false, true);
  await flush();
  requests[1]!.reject(new Error("offline"));
  await expect(like).rejects.toThrow();
  // The unlike, made after it, stands.
  expect(shown("artist", "r1")).toBe(false);
  await flush();
  requests[2]!.resolve();
  await unlike;
});

test("signing out forgets the likes and drops what was on its way", async () => {
  const { likes, requests, saved, shown } = setup();
  const first = likes.set("track", "t1", true, false);
  const second = likes.set("track", "t1", false, true);
  await flush();
  likes.reset();
  expect(shown("track", "t1")).toBeUndefined();
  await flush();
  requests[0]!.resolve();
  await first;
  await second;
  // The second change was never sent, and nothing reports as saved.
  expect(requests).toHaveLength(1);
  expect(saved).toEqual([]);
});
