// Uploading music: a queue of files sent a couple at a time, each followed until the server
// has added it to the library. Lives as long as the session, so it keeps going while the
// admin looks at other pages.
import { createStore, type StoreApi } from "zustand/vanilla";
import type { Schemas } from "../api/client";

type Track = Schemas["TrackOut"];
type UploadResult = Schemas["UploadResult"];
type ImportStatus = Schemas["ImportStatus"];

// What the server takes (app.config.AUDIO_EXTENSIONS, app.library.tags, app.lyrics.models).
const AUDIO = new Set([".mp3", ".flac", ".ogg", ".opus", ".m4a", ".aac", ".wav", ".wma"]);
const COVER_NAMES = new Set(["cover", "folder", "front", "album", "albumart"]);
const COVER_SUFFIXES = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const LYRICS_SUFFIXES = new Set([".lrc", ".txt"]);

/** File types for the file picker. */
export const ACCEPT = [...AUDIO, ...COVER_SUFFIXES, ...LYRICS_SUFFIXES].join(",");

const CONCURRENCY = 2;
const STATUS_POLL_MS = 1500;
const STATUS_BATCH = 100;

export type UploadState =
  | { stage: "waiting" }
  /** `progress` from 0 to 1. */
  | { stage: "uploading"; progress: number }
  /** Saved; the server is adding it to the library. */
  | { stage: "importing"; path: string }
  | { stage: "added"; path: string; track: Track }
  /** A cover or lyrics file, saved beside the album's tracks. */
  | { stage: "saved"; path: string }
  /** The same file was in the library already; its track, once known (null: none). */
  | { stage: "duplicate"; path: string; track?: Track | null }
  /** Saved, but the server couldn't add it: not audio after all, damaged. */
  | { stage: "failed"; path: string; error: string | null }
  /** Not uploaded: the connection broke, the server refused it. Can be tried again. */
  | { stage: "error"; error: unknown };

export interface Upload {
  id: number;
  file: File;
  /** Its folder within what was dropped or picked, e.g. "Artist/Album"; "" for a loose file. */
  folder: string;
  audio: boolean;
  state: UploadState;
}

export interface UploadsState {
  items: Upload[];
  /** Files left out of the latest additions: not music, a cover or lyrics. */
  skipped: number;
  /** How the uploads went, set each time the queue runs out (a new object every time). */
  finished: { added: number; failed: number } | null;
}

/** A file picked or dropped, with its folder inside what was picked or dropped. */
export interface Picked {
  file: File;
  folder: string;
}

export interface UploadsDeps {
  send(
    file: File,
    folder: string,
    onProgress: (progress: number) => void,
    signal: AbortSignal,
  ): Promise<UploadResult>;
  status(paths: string[]): Promise<ImportStatus[]>;
  /** Files were added to the library (or failed to be), and nothing is left to do. */
  finished(): void;
}

export type Uploads = ReturnType<typeof createUploads>;

const suffix = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};
const stem = (name: string) => {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
};

const active = (state: UploadState) =>
  state.stage === "waiting" || state.stage === "uploading" || state.stage === "importing";

/** Whether the upload is still going: waiting, being sent or being added. */
export const inProgress = (upload: Upload) => active(upload.state);

/** Which of the picked files to upload: music, album covers (cover.jpg, folder.png...)
 * and lyrics beside a track (same name, .lrc or .txt). Hidden files are ignored. Covers
 * and lyrics come first, so they are there when their album's tracks are added. */
export function choose(picked: Picked[]): { chosen: Picked[]; skipped: number } {
  const visible = picked.filter(
    ({ file, folder }) =>
      !file.name.startsWith(".") && !folder.split("/").some((part) => part.startsWith(".")),
  );
  const order = (item: Picked) => `${item.folder}/${item.file.name}`;
  visible.sort((a, b) => order(a).localeCompare(order(b), undefined, { numeric: true }));
  const tracks = new Set(
    visible
      .filter(({ file }) => AUDIO.has(suffix(file.name)))
      .map(({ file, folder }) => `${folder}/${stem(file.name)}`),
  );
  const extras: Picked[] = [];
  const audio: Picked[] = [];
  for (const item of visible) {
    const ext = suffix(item.file.name);
    if (AUDIO.has(ext)) audio.push(item);
    else if (COVER_SUFFIXES.has(ext) && COVER_NAMES.has(stem(item.file.name))) extras.push(item);
    else if (LYRICS_SUFFIXES.has(ext) && tracks.has(`${item.folder}/${stem(item.file.name)}`))
      extras.push(item);
  }
  return { chosen: [...extras, ...audio], skipped: visible.length - extras.length - audio.length };
}

export function createUploads(deps: UploadsDeps) {
  const store: StoreApi<UploadsState> = createStore<UploadsState>(() => ({
    items: [],
    skipped: 0,
    finished: null,
  }));
  let nextId = 1;
  const running = new Map<number, AbortController>();
  let poll: ReturnType<typeof setTimeout> | null = null;
  // Outcomes since the queue was last empty, for the message when it empties again.
  let added = 0;
  let failed = 0;

  const update = (id: number, state: UploadState) =>
    store.setState(({ items }) => ({
      items: items.map((item) => (item.id === id ? { ...item, state } : item)),
    }));
  const get = (id: number) => store.getState().items.find((item) => item.id === id);

  function settle(state: UploadState) {
    if (state.stage === "added") added++;
    if (state.stage === "failed" || state.stage === "error") failed++;
  }

  function pump() {
    const { items } = store.getState();
    // Covers and lyrics first: an album's tracks wait until its other files are saved.
    const extrasPending = items.some(
      (item) => !item.audio && (item.state.stage === "waiting" || item.state.stage === "uploading"),
    );
    for (const item of items) {
      if (running.size >= CONCURRENCY) break;
      if (item.state.stage !== "waiting" || (item.audio && extrasPending)) continue;
      void upload(item);
    }
    finishIfIdle();
  }

  async function upload(item: Upload) {
    const controller = new AbortController();
    running.set(item.id, controller);
    update(item.id, { stage: "uploading", progress: 0 });
    let next: UploadState;
    try {
      const result = await deps.send(
        item.file,
        item.folder,
        (progress) => {
          if (get(item.id)?.state.stage === "uploading") {
            update(item.id, { stage: "uploading", progress });
          }
        },
        controller.signal,
      );
      if (result.duplicate)
        next = { stage: "duplicate", path: result.path, ...(item.audio ? {} : { track: null }) };
      else
        next = item.audio
          ? { stage: "importing", path: result.path }
          : { stage: "saved", path: result.path };
    } catch (error) {
      if (controller.signal.aborted) return;
      next = { stage: "error", error };
    } finally {
      running.delete(item.id);
    }
    settle(next);
    update(item.id, next);
    watch();
    pump();
  }

  /** Asks the server how the imports are going while some are. */
  function watch() {
    if (poll !== null) return;
    const waiting = () =>
      store
        .getState()
        .items.filter(
          (item) =>
            item.state.stage === "importing" ||
            (item.state.stage === "duplicate" && item.state.track === undefined),
        );
    if (!waiting().length) return;
    poll = setTimeout(async () => {
      const items = waiting();
      try {
        for (let i = 0; i < items.length; i += STATUS_BATCH) {
          const batch = items.slice(i, i + STATUS_BATCH);
          const paths = batch.map((item) => (item.state as { path: string }).path);
          const statuses = new Map((await deps.status(paths)).map((s) => [s.path, s]));
          for (const item of batch) {
            const current = get(item.id);
            if (!current) continue;
            const known = statuses.get((current.state as { path: string }).path);
            if (known) resolve(current, known);
          }
        }
      } catch {
        // Offline for a moment: ask again next time.
      }
      poll = null;
      watch();
      finishIfIdle();
    }, STATUS_POLL_MS);
  }

  function resolve(item: Upload, status: ImportStatus) {
    const { state } = item;
    if (state.stage === "duplicate") {
      update(item.id, { ...state, track: status.track });
      return;
    }
    if (state.stage !== "importing") return;
    let next: UploadState | null = null;
    if (status.state === "imported" && status.track) {
      next = { stage: "added", path: state.path, track: status.track };
    } else if (status.state === "failed" || status.state === "missing") {
      next = { stage: "failed", path: state.path, error: status.error };
    }
    if (next) {
      settle(next);
      update(item.id, next);
    }
  }

  function finishIfIdle() {
    if (store.getState().items.some(inProgress) || added + failed === 0) return;
    store.setState({ finished: { added, failed } });
    deps.finished();
    added = 0;
    failed = 0;
  }

  return {
    store,
    /** Queues the picked files that can be uploaded. */
    add(picked: Picked[]) {
      const { chosen, skipped } = choose(picked);
      store.setState(({ items }) => ({
        skipped,
        items: [
          ...items,
          ...chosen.map(({ file, folder }) => ({
            id: nextId++,
            file,
            folder,
            audio: AUDIO.has(suffix(file.name)),
            state: { stage: "waiting" } as const,
          })),
        ],
      }));
      pump();
    },
    /** Sends a file that didn't get through once more. */
    retry(id: number) {
      if (get(id)?.state.stage !== "error") return;
      update(id, { stage: "waiting" });
      pump();
    },
    /** Forgets the files that are done with (added, failed, ...), keeps the rest. */
    clear() {
      store.setState(({ items }) => ({ items: items.filter(inProgress), skipped: 0 }));
    },
    /** Stops everything and forgets it (signing out). */
    reset() {
      for (const controller of running.values()) controller.abort();
      running.clear();
      if (poll !== null) clearTimeout(poll);
      poll = null;
      added = 0;
      failed = 0;
      store.setState({ items: [], skipped: 0, finished: null });
    },
  };
}
