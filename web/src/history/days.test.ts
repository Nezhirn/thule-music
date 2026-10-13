import { en } from "../i18n/en";
import { ru } from "../i18n/ru";
import { dayHeading } from "./days";

// Local times: the headings are days of the device's calendar.
const NOW = new Date(2026, 9, 13, 0, 30); // Tuesday 13 October 2026, half past midnight

test("today and yesterday by the calendar, not by 24 hours", () => {
  expect(dayHeading(new Date(2026, 9, 13, 0, 5), NOW, "en", en)).toBe("Today");
  expect(dayHeading(new Date(2026, 9, 12, 23, 50), NOW, "en", en)).toBe("Yesterday");
  expect(dayHeading(new Date(2026, 9, 12, 0, 40), NOW, "ru", ru)).toBe("Вчера");
});

test("earlier days by weekday and date; another year's with the year", () => {
  expect(dayHeading(new Date(2026, 9, 11, 12), NOW, "en", en)).toBe("Sunday 11 October");
  expect(dayHeading(new Date(2026, 9, 11, 12), NOW, "ru", ru)).toBe("Воскресенье, 11 октября");
  expect(dayHeading(new Date(2025, 11, 31, 12), NOW, "en", en)).toBe("31 December 2025");
  expect(dayHeading(new Date(2025, 11, 31, 12), NOW, "ru", ru)).toMatch(/^31 декабря 2025/);
});
