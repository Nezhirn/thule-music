import { WIND, album, artistOut, track } from "../test/catalog";
import { clean, closeness, fold, topResult } from "./match";

test("folding ignores case, accents and ё, not й", () => {
  expect(fold("Café Del Mar")).toBe("cafe del mar");
  expect(fold("Ёлки")).toBe("елки");
  expect(fold("Мой")).toBe("мой");
  expect(fold("Мой")).not.toBe(fold("Мои"));
});

test("a query is trimmed and its spaces collapsed", () => {
  expect(clean("  тихие   города ")).toBe("тихие города");
});

test("closeness: the name, its start, a word's start, the rest", () => {
  expect(closeness("Кино", "кино")).toBe(3);
  expect(closeness("Кино-Кот", "кино")).toBe(2);
  expect(closeness("Песня про ёжика", "ежик")).toBe(1);
  expect(closeness("Северный Ветер", "ветер")).toBe(1);
  expect(closeness("Ветерок", "тер")).toBe(0);
  expect(closeness("Katatonia", "katatonya")).toBe(0);
});

test("the top result answers the query best, artists first on a tie", () => {
  const quiet = album("Тихие города", WIND);
  const dawn = track("Рассвет", quiet);
  const wind = artistOut(WIND);
  // The artist's name; their album and track were found by it.
  expect(topResult("северный ветер", { artists: [wind], albums: [quiet], tracks: [dawn] })).toEqual(
    { kind: "artist", artist: wind },
  );
  expect(
    topResult("тихие", { artists: [], albums: [quiet], tracks: [track("Тихие", quiet)] }),
  ).toMatchObject({ kind: "track" });
  expect(topResult("рассв", { artists: [wind], albums: [], tracks: [dawn] })).toEqual({
    kind: "track",
    track: dawn,
  });
  // Misspelt: nothing answers it by name, the artist goes first.
  expect(topResult("сиверный", { artists: [wind], albums: [quiet], tracks: [] })).toMatchObject({
    kind: "artist",
  });
  expect(topResult("x", { artists: [], albums: [], tracks: [] })).toBeNull();
});
