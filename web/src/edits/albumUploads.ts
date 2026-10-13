// Uploading files into an album, or an artist's album by its title: a queue sent one file at
// a time, outside React, so it goes on when the dialog is closed.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Schemas } from "../api/client";

type Track = Schemas["TrackOut"];

/** The formats whose tags the server can write (app.library.tagwrite). */
export const ACCEPT = ".mp3,.flac,.ogg,.opus,.m4a";

export type AlbumUploadState =
  | { stage: "waiting" }
  /** `progress` from 0 to 1. */
  | { stage: "sending"; progress: number }
  | { stage: "added"; track: Track }
  | { stage: "duplicate"; track: Track }
  | { stage: "failed"; error: unknown };

/** Where a file goes: into an album; or into the artist's album titled `album`, a new one
 * if they have none (with this year and genre). */
export type UploadTarget =
  | { kind: "album"; albumId: string }
  | { kind: "artist"; artistId: string; album: string; year: number | null; genre: string | null };

/** The dialog showing an upload: its album's, or its artist's. */
export const placeOf = (target: UploadTarget) =>
  target.kind === "album" ? `album:${target.albumId}` : `artist:${target.artistId}`;

export interface AlbumUploadItem {
  id: number;
  target: UploadTarget;
  place: string;
  file: File;
  state: AlbumUploadState;
}

export interface AlbumUploadsState {
  items: AlbumUploadItem[];
  /** How many tracks were added, set each time the queue runs out (a new object every
   * time). */
  finished: { added: number } | null;
}

export interface AlbumUploads {
  store: StoreApi<AlbumUploadsState>;
  add(target: UploadTarget, files: File[]): void;
  /** Forgets the finished uploads shown in a place (see placeOf). */
  clear(place: string): void;
  /** Stops and forgets everything (signing out). */
  reset(): void;
}

export interface AlbumUploadDeps {
  send(
    target: UploadTarget,
    file: File,
    onProgress: (progress: number) => void,
    signal: AbortSignal,
  ): Promise<Schemas["AlbumUpload"]>;
}

export function createAlbumUploads(deps: AlbumUploadDeps): AlbumUploads {
  const store = createStore<AlbumUploadsState>(() => ({ items: [], finished: null }));
  let next = 1;
  let running = false;
  let controller = new AbortController();
  // Since the queue last ran out.
  let added = 0;

  const set = (id: number, state: AlbumUploadState) =>
    store.setState(({ items }) => ({
      items: items.map((item) => (item.id === id ? { ...item, state } : item)),
    }));

  async function run() {
    if (running) return;
    running = true;
    const { signal } = controller;
    for (;;) {
      const item = store.getState().items.find((one) => one.state.stage === "waiting");
      if (!item || signal.aborted) break;
      set(item.id, { stage: "sending", progress: 0 });
      try {
        const result = await deps.send(
          item.target,
          item.file,
          (progress) => set(item.id, { stage: "sending", progress }),
          signal,
        );
        set(item.id, { stage: result.duplicate ? "duplicate" : "added", track: result.track });
        if (!result.duplicate) added++;
      } catch (error) {
        if (signal.aborted) break;
        set(item.id, { stage: "failed", error });
      }
    }
    running = false;
    if (!signal.aborted) store.setState({ finished: { added } });
    added = 0;
  }

  return {
    store,
    add(target, files) {
      const items = files.map((file) => ({
        id: next++,
        target,
        place: placeOf(target),
        file,
        state: { stage: "waiting" } as const,
      }));
      store.setState((state) => ({ items: [...state.items, ...items] }));
      void run();
    },
    clear(place) {
      store.setState(({ items }) => ({
        items: items.filter(
          (item) =>
            item.place !== place ||
            item.state.stage === "waiting" ||
            item.state.stage === "sending",
        ),
      }));
    },
    reset() {
      controller.abort();
      controller = new AbortController();
      store.setState({ items: [], finished: null });
    },
  };
}
