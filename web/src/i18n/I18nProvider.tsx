import { useEffect, useMemo, useState, type ReactNode } from "react";
import { I18nContext, MESSAGES, saveLanguage, savedLanguage, type I18n } from ".";

/** The UI language: the one last chosen on this device (an account's setting is applied as
 * such a choice when it signs in), or the browser's. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState(savedLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18n>(
    () => ({
      language,
      t: MESSAGES[language],
      setLanguage(next) {
        saveLanguage(next);
        setLanguage(next);
      },
    }),
    [language],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}
