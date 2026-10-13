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
 * 1). XMLHttpRequest rather than fetch: only it tells how the upload goes. Renews the
 * access token and tries again once if the server rejected it, as the API client does. */
export async function sendFile(
  file: File,
  folder: string,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<UploadResult> {
  let token = await getAccessToken();
  for (let attempt = 0; ; attempt++) {
    const response = await post(file, folder, token, onProgress, signal);
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
    if (!response.ok) throw new ApiFailure(response, body);
    const [result] = body as UploadResult[];
    if (!result) throw new ApiFailure(response, null);
    return result;
  }
}

function post(
  file: File,
  folder: string,
  token: string | null,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/library/uploads");
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
    const form = new FormData();
    form.append("folder", folder);
    form.append("files", file, file.name);
    xhr.send(form);
  });
}
