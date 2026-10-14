import type { Language, Messages } from "../i18n";

const LOCALES: Record<Language, string> = { en: "en-GB", ru: "ru" };

// Made once per language and kind: a formatter is costly to make, and a long history asks
// for one per play.
const formats = new Map<string, Intl.DateTimeFormat>();

function format(language: Language, sameYear: boolean): Intl.DateTimeFormat {
  const key = `${language} ${sameYear}`;
  let made = formats.get(key);
  if (!made) {
    made = new Intl.DateTimeFormat(
      LOCALES[language],
      sameYear
        ? { weekday: "long", day: "numeric", month: "long" }
        : { day: "numeric", month: "long", year: "numeric" },
    );
    formats.set(key, made);
  }
  return made;
}

/** The heading of a day of the history: today, yesterday, the weekday and date, and the
 * year too for another year's. In the device's time zone. */
export function dayHeading(when: Date, now: Date, language: Language, t: Messages): string {
  const day = startOfDay(when);
  const today = startOfDay(now);
  if (day === today) return t.history.today;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day === startOfDay(yesterday)) return t.history.yesterday;
  const text = format(language, when.getFullYear() === now.getFullYear()).format(when);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
