import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, type Schemas } from "../api/client";
import { unwrap } from "../api/errors";
import { preferencesQuery } from "../auth/queries";

export type Preferences = Schemas["Preferences"];
/** Settings to change; `null` resets the accent or the language to the default. */
export type PreferencesChange = Partial<Preferences>;

const { queryKey } = preferencesQuery;
export const PREFERENCES_MUTATION = ["preferences"];

/** The signed-in user's settings, as loaded with the session (undefined once it ends). */
export function usePreferences(): Preferences | undefined {
  return useQuery({ ...preferencesQuery, enabled: false }).data;
}

/** Saves settings on the server. They apply at once and are put back if the server refuses;
 * changes made meanwhile (rapid clicks) are kept apart, so a late answer to an earlier change
 * doesn't undo a later one. */
export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: PREFERENCES_MUTATION,
    mutationFn: (change: PreferencesChange) =>
      unwrap(api.PATCH("/api/v1/me/preferences", { body: change })),
    async onMutate(change) {
      await queryClient.cancelQueries({ queryKey });
      const before = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (current) => current && { ...current, ...change });
      return { before };
    },
    onError(_error, change, context) {
      const before = context?.before;
      if (!before) return;
      // Only the settings this change set, and only if no later change has set them since.
      queryClient.setQueryData(queryKey, (current) => {
        if (!current) return current;
        const reverted = { ...current };
        for (const key of Object.keys(change) as (keyof Preferences)[]) {
          if (current[key] === change[key]) Object.assign(reverted, { [key]: before[key] });
        }
        return reverted;
      });
    },
    onSuccess(saved) {
      // The answer to the last pending change carries all of them.
      if (!isSaving(queryClient, 1)) queryClient.setQueryData(queryKey, saved);
    },
  });
}

/** Whether more than `own` changes of the settings are on their way to the server. */
export function isSaving(queryClient: QueryClient, own = 0): boolean {
  return queryClient.isMutating({ mutationKey: PREFERENCES_MUTATION }) > own;
}
