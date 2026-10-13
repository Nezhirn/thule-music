import { useUpdatePreferences } from "../account/preferences";
import { useI18n, type Language } from "../i18n";
import { useSession } from "./session";

/** Switches the UI language: on this device, and for a signed-in user also in the account's
 * settings (switched at once, switched back if the server refuses). */
export function useChooseLanguage(): {
  choose(language: Language): void;
  /** Why the last change wasn't saved, if it wasn't. */
  error: Error | null;
} {
  const { language: current, setLanguage } = useI18n();
  const { status } = useSession();
  const save = useUpdatePreferences();

  return {
    choose(language) {
      setLanguage(language);
      if (status === "authenticated") {
        save.mutate({ language }, { onError: () => setLanguage(current) });
      }
    },
    error: save.error,
  };
}
