import type { Schemas } from "../api/client";
import { ApiFailure } from "../api/errors";
import { getAccessToken, renewAccessToken } from "../auth/tokens";
import type { UploadTarget } from "../edits/albumUploads";

type UploadResult = Schemas["UploadResult"];

/** The picked file can't be read any more (moved, deleted, no permission). */
export class UnreadableFile extends Error {
  constructor(name: string) {
    super(`Can't read ${name}`);
    this.name = "UnreadableFile";
  }
}

/** Uploads one file into `folder` of the uploads, reporting how much of it is sent (0 to
 * 1). */
export async function sendFile(
  file: File,
  folder: string,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<UploadResult> {
  const form = () => {
    const data = new FormData();
    data.append("folder", folder);
    data.append("files", file, file.name);
    return data;
  };
  const response = await send("/api/v1/library/uploads", form, file, onProgress, signal);
  const [result] = (await response.json()) as UploadResult[];
  if (!result) throw new ApiFailure(response, null);
  return result;
}

/** Uploads an audio file into an album, or an artist's album (see sendFile). */
export async function sendToAlbum(
  target: UploadTarget,
  file: File,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Schemas["AlbumUpload"]> {
  const form = () => {
    const data = new FormData();
    data.append("file", file, file.name);
    if (target.kind === "artist") {
      data.append("album", target.album);
      if (target.year !== null) data.append("year", String(target.year));
      if (target.genre !== null) data.append("genre", target.genre);
    }
    return data;
  };
  const url =
    target.kind === "album"
      ? `/api/v1/albums/${target.albumId}/tracks`
      : `/api/v1/artists/${target.artistId}/tracks`;
  const response = await send(url, form, file, onProgress, signal);
  return (await response.json()) as Schemas["AlbumUpload"];
}

/** Posts a form with a file, reporting how much of it is sent. XMLHttpRequest rather than
 * fetch: only it tells how the upload goes. Renews the access token and tries again once if
 * the server rejected it, as the API client does. Resolves with a successful response. */
async function send(
  url: string,
  form: () => FormData,
  file: File,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Response> {
  let token = await getAccessToken();
  for (let attempt = 0; ; attempt++) {
    const response = await post(url, form(), file, token, onProgress, signal);
    if (response.ok) return response;
    const body: unknown = await response.json().catch(() => null);
    if (
      response.status === 401 &&
      attempt === 0 &&
      token !== null &&
      (body as { code?: string } | null)?.code === "invalid_token"
    ) {
      token = await renewAccessToken(token);
      if (token !== null) continue;
    }
    throw new ApiFailure(response, body);
  }
}

// How often the progress is reported at most (ms): each report renders the list of uploads.
const PROGRESS_EVERY = 250;
// An upload that sends nothing for this long (ms) has stalled: a connection gone without a
// word. Once all of it is sent, the server has this much longer to save it and answer.
const STALLED_AFTER = 60_000;
const ANSWER_WITHIN = 5 * 60_000;

function post(
  url: string,
  form: FormData,
  file: File,
  token: string | null,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (token !== null) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    let stalled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const wait = (ms: number) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, ms);
    };
    let reported = 0;
    xhr.upload.onprogress = (event) => {
      wait(STALLED_AFTER);
      if (!event.lengthComputable || event.total <= 0) return;
      const now = Date.now();
      if (event.loaded < event.total && now - reported < PROGRESS_EVERY) return;
      reported = now;
      onProgress(event.loaded / event.total);
    };
    xhr.upload.onload = () => wait(ANSWER_WITHIN);
    xhr.onloadend = () => clearTimeout(watchdog);
    xhr.onload = () => {
      const headers = new Headers();
      for (const name of ["Content-Type", "Retry-After"]) {
        const value = xhr.getResponseHeader(name);
        if (value !== null) headers.set(name, value);
      }
      resolve(new Response(xhr.responseText || null, { status: xhr.status, headers }));
    };
    // As fetch does: a TypeError when the server can't be reached. Unless it is the file
    // that can't be read (moved or deleted since it was picked).
    xhr.onerror = () =>
      void file
        .slice(0, 1)
        .arrayBuffer()
        .then(
          () => reject(new TypeError("Network error")),
          () => reject(new UnreadableFile(file.name)),
        );
    xhr.onabort = () =>
      reject(
        stalled
          ? new TypeError("The upload stalled")
          : new DOMException("Upload stopped", "AbortError"),
      );
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    wait(STALLED_AFTER);
    xhr.send(form);
  });
}
