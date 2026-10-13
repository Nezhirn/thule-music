export type Language = "ru" | "en";
export const LANGUAGES: readonly Language[] = ["ru", "en"];

const rules: Record<Language, Intl.PluralRules> = {
  ru: new Intl.PluralRules("ru"),
  en: new Intl.PluralRules("en"),
};

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/** Picks the plural form for `n` and puts `n` in place of `#`: Russian needs one, few and
 * many ("1 минуту", "3 минуты", "5 минут"), English one and other. */
export function plural(language: Language, n: number, forms: PluralForms): string {
  return (forms[rules[language].select(n)] ?? forms.other).replace("#", String(n));
}
