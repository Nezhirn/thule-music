/** A signal that aborts after `ms`, for a request that mustn't hang for ever. (Like
 * AbortSignal.timeout, but on the page's own timers.) */
export function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException("The request timed out", "TimeoutError")), ms);
  return controller.signal;
}
