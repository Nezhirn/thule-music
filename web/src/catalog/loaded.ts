import { ApiFailure } from "../api/errors";

export interface Loaded {
  isError: boolean;
  isFetchNextPageError?: boolean;
  data: unknown;
  error: unknown;
}

/** Whether a query's error shows in place of what it shows: nothing was loaded, or the
 * thing is gone (404). A refresh failing for a while (the server restarting, a laptop
 * waking up) keeps what was shown, with `RefreshFailed` over it. */
export function failedToLoad<Q extends Loaded>(query: Q): query is Q & { data: undefined } {
  return (
    query.isError &&
    (query.data === undefined || (query.error instanceof ApiFailure && query.error.status === 404))
  );
}
