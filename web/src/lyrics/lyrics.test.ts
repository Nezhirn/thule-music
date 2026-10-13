import { stanzas, type Lyrics } from "./queries";

const base: Lyrics = {
  track_id: "t",
  source: "sidecar",
  instrumental: false,
  synced: false,
  lines: [],
  plain: null,
};

test("plain lyrics split into stanzas at blank lines", () => {
  expect(stanzas({ ...base, plain: "One\r\ntwo\n\n  \nThree  \n\n\n" })).toEqual([
    ["One", "two"],
    ["Three"],
  ]);
});

test("timed lines without a plain text read without their times", () => {
  const lines = [
    { time_ms: 1000, text: "One" },
    { time_ms: 2000, text: "" },
    { time_ms: 3000, text: "Two" },
  ];
  expect(stanzas({ ...base, synced: true, lines })).toEqual([["One"], ["Two"]]);
});

test("no words, no stanzas", () => {
  expect(stanzas({ ...base, plain: "\n \n" })).toEqual([]);
  expect(stanzas(base)).toEqual([]);
});
