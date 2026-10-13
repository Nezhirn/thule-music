import type { Language, Messages } from "../i18n";
import type { Scan } from "./queries";

const LOCALES: Record<Language, string> = { en: "en-GB", ru: "ru" };

const unit = (language: Language, name: string, n: number, digits = 0) =>
  new Intl.NumberFormat(LOCALES[language], {
    style: "unit",
    unit: name,
    unitDisplay: "short",
    maximumFractionDigits: digits,
  }).format(n);

/** A count with the language's digit grouping: 12 345, 12,345. */
export function count(language: Language, n: number): string {
  return new Intl.NumberFormat(LOCALES[language]).format(n);
}

/** Hours and minutes of music: "6 ч 57 мин", "6 hr 57 min"; just minutes under an hour. */
export function hoursOfMusic(language: Language, ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = unit(language, "minute", minutes % 60);
  return hours ? `${unit(language, "hour", hours)} ${rest}` : rest;
}

/** A size in bytes the way people read it: "830 КБ", "12 MB", "1.4 GB". */
export function fileSize(language: Language, bytes: number): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];
  let value = bytes;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  return unit(language, units[i] as string, value, value < 10 && i > 1 ? 1 : 0);
}

/** When something happened, relative while recent: "5 минут назад", "yesterday", then a
 * date ("12 марта 2025 г."). */
export function ago(language: Language, when: Date, now = new Date()): string {
  const seconds = Math.round((when.getTime() - now.getTime()) / 1000);
  const relative = new Intl.RelativeTimeFormat(LOCALES[language], { numeric: "auto" });
  if (Math.abs(seconds) < 60) return relative.format(0, "second");
  if (Math.abs(seconds) < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (Math.abs(seconds) < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return date(language, when);
}

/** A date: "12 марта 2025 г.", "12 March 2025". */
export function date(language: Language, when: Date): string {
  return new Intl.DateTimeFormat(LOCALES[language], { dateStyle: "long" }).format(when);
}

/** What a scan found, as a phrase: "добавлено 3, удалено 1". */
export function foundText(t: Messages, result: NonNullable<Scan["result"]>): string {
  const found = t.admin.scan.found;
  const parts = (["added", "updated", "moved", "removed"] as const)
    .filter((key) => result[key] > 0)
    .map((key) => found[key](result[key]));
  return parts.length ? parts.join(", ") : t.admin.scan.unchanged;
}
