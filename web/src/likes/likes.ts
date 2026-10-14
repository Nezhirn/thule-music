import { createStore, type StoreApi } from "zustand/vanilla";

/** What can be liked: tracks (Liked songs), albums and artists (Favourites). */
export type LikeKind = "track" | "album" | "artist";

/** Likes changed on this device and still on their way to the server, by kind and id. They
 * stand over the `liked` of what the pages loaded until the server has them; the pages
 * are then changed to match (`saved`), and show the like as loaded again. */
export type LikesState = Record<LikeKind, Record<string, boolean>>;

export interface Likes {
  store: StoreApi<LikesState>;
  /** Likes or unlikes at once, then on the server. If the server refuses the last change
   * of the item, the like the server has (`was`, or a later change it took) shows again.
   * Changes of one item reach the server in the order they were made. */
  set(kind: LikeKind, id: string, liked: boolean, was: boolean): Promise<void>;
  /** Forgets everything (signing out); changes still on their way are dropped. */
  reset(): void;
}

export interface Deps {
  send(kind: LikeKind, id: string, liked: boolean): Promise<void>;
  /** The like shown changed (set, or put back). */
  changed?(kind: LikeKind, id: string, liked: boolean): void;
  /** The server has it: the pages loaded should show it. */
  saved?(kind: LikeKind, id: string, liked: boolean): void;
}

const EMPTY: LikesState = { track: {}, album: {}, artist: {} };

export function createLikes(deps: Deps): Likes {
  const store = createStore<LikesState>(() => EMPTY);
  // Per item with changes on their way: the last one sent (the next waits for it), the like
  // the server has as far as this device knows, and the latest change made.
  const items = new Map<string, { sending: Promise<unknown>; saved: boolean; latest: number }>();
  let changes = 0;
  let generation = 0;

  const show = (kind: LikeKind, id: string, liked: boolean) => {
    store.setState((state) => ({ ...state, [kind]: { ...state[kind], [id]: liked } }));
    deps.changed?.(kind, id, liked);
  };

  /** Nothing of the item on its way any more: the pages show what the server has. */
  const settle = (kind: LikeKind, id: string, saved: boolean) => {
    if (store.getState()[kind][id] !== saved) deps.changed?.(kind, id, saved);
    store.setState((state) => {
      const rest = { ...state[kind] };
      delete rest[id];
      return { ...state, [kind]: rest };
    });
  };

  return {
    store,
    async set(kind, id, liked, was) {
      const ours = generation;
      const change = ++changes;
      const key = `${kind}:${id}`;
      const item = items.get(key) ?? { sending: Promise.resolve(), saved: was, latest: change };
      item.latest = change;
      items.set(key, item);
      show(kind, id, liked);
      const sent = item.sending.then(() =>
        ours === generation ? deps.send(kind, id, liked) : undefined,
      );
      item.sending = sent.catch(() => {});
      try {
        await sent;
        item.saved = liked;
        if (ours === generation) deps.saved?.(kind, id, liked);
      } finally {
        if (ours === generation && item.latest === change) {
          items.delete(key);
          settle(kind, id, item.saved);
        }
      }
    },
    reset() {
      generation += 1;
      items.clear();
      store.setState(EMPTY, true);
    },
  };
}
