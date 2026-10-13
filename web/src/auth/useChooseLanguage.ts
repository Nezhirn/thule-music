import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Schemas } from "../api/client";
import { unwrap } from "../api/errors";
import { useI18n, type Language } from "../i18n";
import { preferencesQuery } from "./queries";
import { useSession } from "./session";

type Preferences = Schemas["Preferences"];

/** Switches the UI language: on this device, and for a signed-in user also in the account's
 * settings (switched at once, switched back if the server refuses). */
export function useChooseLanguage(): (language: Language) => void {
  const { language: current, setLanguage } = useI18n();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const { queryKey } = preferencesQuery;
  const save = useMutation({
    mutationFn: (language: Language) =>
      unwrap(api.PATCH("/api/v1/me/preferences", { body: { language } })),
    onSuccess: (preferences) => queryClient.setQueryData<Preferences>(queryKey, preferences),
  });

  return (language) => {
    setLanguage(language);
    if (status === "authenticated") save.mutate(language, { onError: () => setLanguage(current) });
  };
}
