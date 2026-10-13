import type { Messages } from "../i18n";
import type { Schemas } from "./base";

/** An error response from the API (`{code, detail}`; other bodies, e.g. from a proxy, give
 * no code). Network failures are not ApiFailures: fetch throws a TypeError for those. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: Schemas["ErrorCode"] | null;
  /** Seconds, from the Retry-After header (429). */
  readonly retryAfter: number | null;

  constructor(response: Response, body: unknown) {
    const code = isErrorBody(body) ? body.code : null;
    super(`${response.status} ${code ?? response.statusText}`);
    this.name = "ApiFailure";
    this.status = response.status;
    this.code = code;
    const retryAfter = Number(response.headers.get("Retry-After"));
    this.retryAfter = retryAfter > 0 ? retryAfter : null;
  }
}

function isErrorBody(body: unknown): body is Schemas["ErrorOut"] {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { code?: unknown }).code === "string"
  );
}

/** The data of an openapi-fetch call, or an ApiFailure thrown for an error response. */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  if (!response.ok) throw new ApiFailure(response, error);
  return data as T;
}

/** What to tell the user about a failed call. */
export function errorMessage(t: Messages, error: unknown): string {
  if (!(error instanceof ApiFailure)) return t.common.unreachable;
  // A newer server may send a code this client doesn't know yet.
  return (error.code && t.errors[error.code]) || t.errors.http_error;
}
