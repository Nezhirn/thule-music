import { createContext, useContext } from "react";
import { storage } from "../lib/storage";
import { en, type Messages } from "./en";
import { LANGUAGES, type Language } from "./plural";
import { ru } from "./ru";

export type { Language, Messages };
export { LANGUAGES };

export const MESSAGES: Record<Language, Messages> = { ru, en };

// The language last chosen on this device, here or in the settings of an account signed in on
// it; the browser's preference until then.
const LANGUAGE_KEY = "thule.language";

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

export function savedLanguage(): Language {
  const saved = storage.get(LANGUAGE_KEY);
  return isLanguage(saved) ? saved : deviceLanguage();
}

export function saveLanguage(language: Language): void {
  storage.set(LANGUAGE_KEY, language);
}

/** The first of the browser's preferred languages that we have, English otherwise. */
export function deviceLanguage(tags: readonly string[] = navigator.languages): Language {
  for (const tag of tags) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
  }
  return "en";
}

export interface I18n {
  language: Language;
  t: Messages;
  /** Switches the language and remembers it on this device. */
  setLanguage(language: Language): void;
}

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const i18n = useContext(I18nContext);
  if (!i18n) throw new Error("useI18n outside I18nProvider");
  return i18n;
}
