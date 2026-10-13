import css from "../styles/global.css?raw";
import { contrast, fromOklch, luminance, over, parseHex, toHex, toOklch, type Rgb } from "./color";
import {
  ACCENT_PRESETS,
  AMBIENT_ALPHA,
  AMBIENT_MAX_LUMINANCE,
  BG,
  DANGER,
  DEFAULT_ACCENT,
  GLASS,
  GLASS_ALPHA,
  HIGHLIGHT_ALPHA,
  SUCCESS,
  TEXT,
  TEXT_MUTED,
  WORST_SURFACE,
  accentTokens,
  ambientColors,
  ambientTone,
} from "./theme";

// Deterministic pseudo-random colours (a fixed-seed LCG), so a failure reproduces.
function* colours(count: number): Generator<string> {
  let seed = 42;
  for (let i = 0; i < count; i++) {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    yield toHex([seed & 255, (seed >> 8) & 255, (seed >> 16) & 255]);
  }
}
const SAMPLES = [...colours(400), "#000000", "#ffffff", "#808080", "#ffff00", "#00ff00", "#0000ff"];

/** Glass over a backdrop where all three colour fields overlap, plus a row highlight. */
function surfaceOver(fields: Rgb[]): Rgb {
  const backdrop = fields.reduce<Rgb>(
    (under, field, i) => over(field, AMBIENT_ALPHA[i] ?? 1, under),
    parseHex(BG),
  );
  return over([255, 255, 255], HIGHLIGHT_ALPHA, over(parseHex(GLASS), GLASS_ALPHA, backdrop));
}

describe("colour", () => {
  it("measures contrast as WCAG does", () => {
    expect(contrast(parseHex("#ffffff"), parseHex("#000000"))).toBeCloseTo(21, 5);
    expect(contrast(parseHex("#6e56f8"), parseHex("#ffffff"))).toBeCloseTo(4.83, 2);
    expect(luminance(parseHex("#808080"))).toBeCloseTo(0.2159, 4);
  });

  it("round-trips through OKLCH", () => {
    for (const hex of SAMPLES.slice(0, 50)) {
      const { l, c, h } = toOklch(parseHex(hex));
      expect(toHex(fromOklch({ l, c, h }))).toBe(hex);
    }
  });
});

describe("accent", () => {
  it("keeps every text colour readable, whatever the accent", () => {
    for (const hex of SAMPLES) {
      const tokens = accentTokens(hex);
      const fill = parseHex(tokens.accent);
      expect(contrast(parseHex(tokens.accentOn), fill), hex).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(parseHex(tokens.accentOn), parseHex(tokens.accentHover)),
        hex,
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parseHex(tokens.accentText), WORST_SURFACE), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses the presets as they are, under white text", () => {
    for (const { color } of ACCENT_PRESETS) {
      expect(accentTokens(color)).toMatchObject({ accent: color, accentOn: "#ffffff" });
    }
  });

  it("puts dark text on a light accent instead of washing it out", () => {
    expect(accentTokens("#ffd60a")).toMatchObject({ accent: "#ffd60a", accentOn: "#0d0e12" });
  });

  it("keeps the hue of the accent in its text shade", () => {
    const { h } = toOklch(parseHex("#1e3a8a")); // dark blue: needs a much lighter text shade
    const text = toOklch(parseHex(accentTokens("#1e3a8a").accentText));
    expect(Math.abs(text.h - h)).toBeLessThan(3);
  });
});

describe("backdrop", () => {
  it("is never lighter than the surface the text colours are checked against", () => {
    for (const hex of SAMPLES) {
      const tone = ambientTone(parseHex(hex));
      expect(luminance(tone), hex).toBeLessThanOrEqual(AMBIENT_MAX_LUMINANCE);
      const surface = surfaceOver([tone, tone, tone]);
      expect(luminance(surface), hex).toBeLessThanOrEqual(luminance(WORST_SURFACE) + 1e-3);
    }
  });

  it("keeps the glass text readable over the brightest backdrop", () => {
    for (const text of [TEXT, TEXT_MUTED, DANGER, SUCCESS]) {
      expect(contrast(parseHex(text), WORST_SURFACE), text).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("takes the cover's colours, toned down", () => {
    const [first, second, third] = ambientColors(DEFAULT_ACCENT, {
      average: "#806040",
      dominant: "#a05020",
      muted: "#605850",
      vibrant: "#ff2000",
      luminance: 0.12,
    });
    expect(hueOf(first)).toBeCloseTo(hueOf("#ff2000"), -1);
    expect(hueOf(second)).toBeCloseTo(hueOf("#a05020"), -1);
    expect(hueOf(third)).toBeCloseTo(hueOf("#605850"), -1);
  });

  it("follows the accent without a cover", () => {
    const violet = ambientColors(DEFAULT_ACCENT, null);
    const green = ambientColors("#15803d", null);
    expect(hueOf(violet[0])).toBeCloseTo(hueOf(DEFAULT_ACCENT), -1);
    expect(hueOf(green[0])).toBeCloseTo(hueOf("#15803d"), -1);
  });

  it("stays grey for a grey accent", () => {
    for (const colour of ambientColors("#52525b", null)) {
      expect(toOklch(parseHex(colour)).c).toBeLessThan(0.04);
    }
  });
});

it("mirrors the tokens of global.css", () => {
  const glass = parseHex(GLASS);
  expect(css).toContain(`--bg: ${BG};`);
  expect(css).toContain(`--text: ${TEXT};`);
  expect(css).toContain(`--text-muted: ${TEXT_MUTED};`);
  expect(css).toContain(`--danger: ${DANGER};`);
  expect(css).toContain(`--success: ${SUCCESS};`);
  expect(css).toContain(`--glass: rgb(${glass.join(" ")} / ${GLASS_ALPHA});`);
  expect(css).toContain(`--selected: rgb(255 255 255 / ${HIGHLIGHT_ALPHA});`);
  const accent = accentTokens(DEFAULT_ACCENT);
  expect(css).toContain(`--accent: ${accent.accent};`);
  expect(css).toContain(`--accent-hover: ${accent.accentHover};`);
  expect(css).toContain(`--accent-on: ${accent.accentOn};`);
  expect(css).toContain(`--accent-text: ${accent.accentText};`);
});

function hueOf(hex: string): number {
  return toOklch(parseHex(hex)).h;
}
