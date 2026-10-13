import type { Schemas } from "../api/client";
import { ApiFailure } from "../api/errors";
import { getAccessToken, renewAccessToken } from "../auth/tokens";

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

/** Uploads an audio file into an album (see sendFile). */
export async function sendToAlbum(
  albumId: string,
  file: File,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Schemas["AlbumUpload"]> {
  const form = () => {
    const data = new FormData();
    data.append("file", file, file.name);
    return data;
  };
  const url = `/api/v1/albums/${albumId}/tracks`;
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
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
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
    xhr.onabort = () => reject(new DOMException("Upload stopped", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
