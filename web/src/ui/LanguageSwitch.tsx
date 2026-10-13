import { LANGUAGES, MESSAGES, useI18n, type Language } from "../i18n";
import styles from "./LanguageSwitch.module.css";

const SHORT: Record<Language, string> = { ru: "RU", en: "EN" };

export function LanguageSwitch({ onChange }: { onChange(language: Language): void }) {
  const { language, t } = useI18n();
  return (
    <div role="group" aria-label={t.common.language} className={styles.switch}>
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === language}
          aria-label={MESSAGES[option].languageName}
          lang={option}
          className={styles.option}
          onClick={() => onChange(option)}
        >
          {SHORT[option]}
        </button>
      ))}
    </div>
  );
}
