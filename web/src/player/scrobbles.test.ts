import { ApiFailure } from "../api/errors";
import { createScrobbler, type Play } from "./scrobbles";

const play = (n: number): Play => ({
  track_id: `track-${n}`,
  listened_ms: 30_000,
  played_at: `2026-10-13T10:0${n}:00.000Z`,
});
const failure = (status: number) => new ApiFailure(new Response(null, { status }), null);

function setup() {
  const sent: Play[] = [];
  let answer: (play: Play) => Promise<void> = async (p) => {
    sent.push(p);
  };
  const scrobbler = createScrobbler((p) => answer(p));
  return {
    sent,
    scrobbler,
    answer: (fn: typeof answer) => (answer = fn),
    kept: () => JSON.parse(localStorage.getItem("thule.pendingPlays") ?? "[]") as Play[],
  };
}

test("a play the server didn't get is kept and sent when it can be, oldest first", async () => {
  const { sent, scrobbler, answer, kept } = setup();
  answer(() => Promise.reject(new TypeError("Failed to fetch")));
  await expect(scrobbler.record(play(1))).rejects.toThrow();
  answer(() => Promise.reject(failure(503)));
  await expect(scrobbler.record(play(2))).rejects.toThrow();
  expect(kept()).toEqual([play(1), play(2)]);

  answer(async (p) => {
    sent.push(p);
  });
  await scrobbler.flush();
  expect(sent).toEqual([play(1), play(2)]);
  expect(kept()).toEqual([]);
});

test("a play sent sends the kept ones after it", async () => {
  const { sent, scrobbler, answer, kept } = setup();
  answer(() => Promise.reject(failure(502)));
  await expect(scrobbler.record(play(1))).rejects.toThrow();
  answer(async (p) => {
    sent.push(p);
  });
  await scrobbler.record(play(2));
  await vi.waitFor(() => expect(sent).toEqual([play(2), play(1)]));
  expect(kept()).toEqual([]);
});

test("a play refused for good is dropped; a session to renew is not", async () => {
  const { scrobbler, answer, kept } = setup();
  answer(() => Promise.reject(failure(404))); // the track deleted meanwhile
  await expect(scrobbler.record(play(1))).rejects.toThrow();
  answer(() => Promise.reject(failure(401)));
  await expect(scrobbler.record(play(2))).rejects.toThrow();
  expect(kept()).toEqual([play(2)]);

  // Kept ones refused are dropped too, the rest still sent.
  let calls = 0;
  answer((p) => {
    calls += 1;
    return p.track_id === "track-2" ? Promise.reject(failure(422)) : Promise.resolve();
  });
  await scrobbler.flush();
  expect(calls).toBe(1);
  expect(kept()).toEqual([]);
});

test("a flush stops at the first play that still doesn't get through", async () => {
  const { scrobbler, answer, kept } = setup();
  answer(() => Promise.reject(failure(503)));
  for (const n of [1, 2, 3]) await expect(scrobbler.record(play(n))).rejects.toThrow();
  let calls = 0;
  answer(() => {
    calls += 1;
    return Promise.reject(failure(503));
  });
  await scrobbler.flush();
  expect(calls).toBe(1);
  expect(kept()).toHaveLength(3);
});

test("at most the latest 500 are kept, and none after signing out", async () => {
  const { scrobbler, answer, kept } = setup();
  const older = Array.from({ length: 500 }, (_, i) => ({ ...play(1), track_id: `old-${i}` }));
  localStorage.setItem("thule.pendingPlays", JSON.stringify(older));
  answer(() => Promise.reject(failure(503)));
  await expect(scrobbler.record(play(2))).rejects.toThrow();
  expect(kept()).toHaveLength(500);
  expect(kept()[0]?.track_id).toBe("old-1");
  expect(kept().at(-1)).toEqual(play(2));
  scrobbler.forget();
  expect(kept()).toEqual([]);
});

test("a play failing after signing out isn't kept for the next user", async () => {
  const { scrobbler, answer, kept } = setup();
  let fail: (error: Error) => void = () => {};
  answer(() => new Promise((_resolve, reject) => (fail = reject)));
  const recorded = scrobbler.record(play(1));
  scrobbler.forget();
  fail(failure(401));
  await expect(recorded).rejects.toThrow();
  expect(kept()).toEqual([]);
});
