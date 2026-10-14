import { ApiFailure } from "../api/errors";
import { storage } from "../lib/storage";

/** A play to record: a track, how long it was listened to, when it started. */
export interface Play {
  track_id: string;
  listened_ms: number;
  played_at: string;
}

export interface Scrobbler {
  /** Sends the play; one that doesn't reach the server is kept and sent again later. */
  record(play: Play): Promise<void>;
  /** Sends the plays kept so far (the connection is back, the app started). */
  flush(): Promise<void>;
  /** Drops the plays kept (signing out: they are the previous user's). */
  forget(): void;
}

// Plays the server didn't get yet, on this device, oldest first.
const KEY = "thule.pendingPlays";
// Kept at most: a device offline for weeks keeps its latest plays.
const MAX = 500;
const LOCK = "thule.plays";

function load(): Play[] {
  try {
    const plays = JSON.parse(storage.get(KEY) ?? "[]") as unknown;
    return Array.isArray(plays) ? (plays as Play[]) : [];
  } catch {
    return [];
  }
}

function save(plays: Play[]) {
  if (plays.length) storage.set(KEY, JSON.stringify(plays.slice(-MAX)));
  else storage.remove(KEY);
}

/** Refused for good: the track is gone, or the play makes no sense to the server. Not a
 * session to renew (401), a server busy (429, 5xx) or one not answering. */
function refused(error: unknown): boolean {
  return (
    error instanceof ApiFailure &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 401 &&
    error.status !== 408 &&
    error.status !== 429
  );
}

/** Plays are recorded with when they happened, so one sent hours later (offline, the server
 * restarting) lands in the history where it belongs instead of being lost. */
export function createScrobbler(send: (play: Play) => Promise<void>): Scrobbler {
  // One tab at a time sends the kept plays: two would send them twice.
  const serialized = async <T>(task: () => Promise<T>): Promise<T> =>
    navigator.locks ? await navigator.locks.request(LOCK, task) : await task();

  // Bumped on signing out: what was on its way for the previous user isn't kept after.
  let generation = 0;

  async function flush() {
    const ours = generation;
    await serialized(async () => {
      for (let sent = 0; sent < MAX && ours === generation; sent++) {
        const first = load()[0];
        if (!first) return;
        try {
          await send(first);
        } catch (error) {
          if (!refused(error)) return; // tried again later
        }
        // Sent (or refused for good): off the list, whatever was added meanwhile kept.
        save(load().filter((play) => !same(play, first)));
      }
    });
  }

  return {
    async record(play) {
      const ours = generation;
      try {
        await send(play);
      } catch (error) {
        if (!refused(error) && ours === generation) save([...load(), play]);
        throw error;
      }
      void flush().catch(() => {});
    },
    flush: () => flush().catch(() => {}),
    forget() {
      generation += 1;
      storage.remove(KEY);
    },
  };
}

function same(a: Play, b: Play): boolean {
  return a.track_id === b.track_id && a.played_at === b.played_at;
}
