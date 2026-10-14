import { en } from "../i18n/en";
import { ru } from "../i18n/ru";
import * as format from "./format";
import { foundText } from "./format";

// Intl puts no-break spaces between numbers and units; compared as plain spaces.
const plain =
  <A extends unknown[]>(f: (...args: A) => string) =>
  (...args: A) =>
    f(...args).replace(/[\u00a0\u202f]/g, " ");
const count = plain(format.count);
const hoursOfMusic = plain(format.hoursOfMusic);
const fileSize = plain(format.fileSize);
const ago = plain(format.ago);

test("numbers of the library read naturally in both languages", () => {
  expect(count("en", 12345)).toBe("12,345");
  expect(count("ru", 12345)).toBe("12 345");
  expect(hoursOfMusic("en", 25_020_000)).toBe("6 hrs 57 mins");
  expect(hoursOfMusic("ru", 25_020_000)).toBe("6 ч 57 мин");
  expect(hoursOfMusic("en", 420_000)).toBe("7 mins");
  expect(fileSize("en", 12_568_659)).toBe("13 MB");
  expect(fileSize("en", 1_400_000_000)).toBe("1.4 GB");
  expect(fileSize("ru", 1_400_000_000)).toBe("1,4 ГБ");
  expect(fileSize("en", 830_000)).toBe("830 kB");
});

test("times are relative while recent, then a date", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const before = (seconds: number) => new Date(now.getTime() - seconds * 1000);
  expect(ago("en", before(20), now)).toBe("now");
  expect(ago("en", before(300), now)).toBe("5 minutes ago");
  expect(ago("ru", before(300), now)).toBe("5 минут назад");
  expect(ago("en", before(3 * 3600), now)).toBe("3 hours ago");
  expect(ago("ru", before(86_400), now)).toBe("вчера");
  expect(ago("en", before(30 * 86_400), now)).toBe("13 September 2026");
});

test("what a scan found, leaving out what didn't happen", () => {
  const nothing = {
    files: 50,
    added: 0,
    updated: 0,
    moved: 0,
    removed: 0,
    missing: 0,
    unreadable: 0,
  };
  const result = { ...nothing, added: 3, moved: 1, removed: 2 };
  expect(foundText(en, result)).toBe("3 added, 1 moved, 2 removed");
  expect(foundText(ru, result)).toBe("добавлено 3, перенесено 1, удалено 2");
  expect(foundText(en, nothing)).toBe("nothing changed");
});
