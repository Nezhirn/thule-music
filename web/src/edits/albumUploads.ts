// Uploading files into an album: a queue sent one file at a time, outside React, so it goes
// on when the dialog is closed.
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

export interface AlbumUploadItem {
  id: number;
  albumId: string;
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
  add(albumId: string, files: File[]): void;
  /** Forgets the finished uploads of the album. */
  clear(albumId: string): void;
  /** Stops and forgets everything (signing out). */
  reset(): void;
}

export interface AlbumUploadDeps {
  send(
    albumId: string,
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
          item.albumId,
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
    add(albumId, files) {
      const items = files.map((file) => ({
        id: next++,
        albumId,
        file,
        state: { stage: "waiting" } as const,
      }));
      store.setState((state) => ({ items: [...state.items, ...items] }));
      void run();
    },
    clear(albumId) {
      store.setState(({ items }) => ({
        items: items.filter(
          (item) =>
            item.albumId !== albumId ||
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
