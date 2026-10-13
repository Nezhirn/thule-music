import { deviceLanguage } from ".";
import { en } from "./en";
import { ru } from "./ru";

test("the device language is the first preferred one we have", () => {
  expect(deviceLanguage(["ru-RU", "en-US"])).toBe("ru");
  expect(deviceLanguage(["de-DE", "en-GB"])).toBe("en");
  expect(deviceLanguage(["de", "fr"])).toBe("en");
});

test("waiting times use the right plural forms", () => {
  const minutes = (seconds: number) => /через (.*)\./.exec(ru.auth.tryAgainIn(seconds))?.[1];
  expect(minutes(30)).toBe("1 минуту");
  expect(minutes(120)).toBe("2 минуты");
  expect(minutes(300)).toBe("5 минут");
  expect(minutes(11 * 60)).toBe("11 минут");
  expect(minutes(21 * 60)).toBe("21 минуту");
  expect(en.auth.tryAgainIn(60)).toContain("in 1 minute.");
  expect(en.auth.tryAgainIn(125)).toContain("in 3 minutes.");
});
