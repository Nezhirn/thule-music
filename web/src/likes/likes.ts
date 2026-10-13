import { createStore, type StoreApi } from "zustand/vanilla";

/** What can be liked: tracks (Liked songs), albums and artists (Favourites). */
export type LikeKind = "track" | "album" | "artist";

/** Likes changed on this device, by kind and id. They stand over the `liked` of what the
 * pages loaded earlier, until those load again. */
export type LikesState = Record<LikeKind, Record<string, boolean>>;

export interface Likes {
  store: StoreApi<LikesState>;
  /** Likes or unlikes at once, then on the server; puts back `was` if the server refuses
   * and nothing changed it again meanwhile. Changes of one item reach the server in the
   * order they were made. */
  set(kind: LikeKind, id: string, liked: boolean, was: boolean): Promise<void>;
  /** Forgets everything (signing out); changes still on their way are dropped. */
  reset(): void;
}

export interface Deps {
  send(kind: LikeKind, id: string, liked: boolean): Promise<void>;
  /** The like shown changed (set, or put back). */
  changed?(kind: LikeKind, id: string, liked: boolean): void;
  /** The server has it. */
  saved?(kind: LikeKind, id: string, liked: boolean): void;
}

const EMPTY: LikesState = { track: {}, album: {}, artist: {} };

export function createLikes(deps: Deps): Likes {
  const store = createStore<LikesState>(() => EMPTY);
  // Per item: the last change on its way to the server; the next one waits for it.
  const sending = new Map<string, Promise<unknown>>();
  let generation = 0;

  const show = (kind: LikeKind, id: string, liked: boolean) => {
    store.setState((state) => ({ ...state, [kind]: { ...state[kind], [id]: liked } }));
    deps.changed?.(kind, id, liked);
  };

  return {
    store,
    async set(kind, id, liked, was) {
      const ours = generation;
      show(kind, id, liked);
      const key = `${kind}:${id}`;
      const sent = (sending.get(key) ?? Promise.resolve()).then(() =>
        ours === generation ? deps.send(kind, id, liked) : undefined,
      );
      sending.set(
        key,
        sent.catch(() => {}),
      );
      try {
        await sent;
      } catch (error) {
        if (ours === generation && store.getState()[kind][id] === liked) show(kind, id, was);
        throw error;
      }
      if (ours === generation) deps.saved?.(kind, id, liked);
    },
    reset() {
      generation += 1;
      sending.clear();
      store.setState(EMPTY, true);
    },
  };
}
