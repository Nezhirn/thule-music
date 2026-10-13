// The colours of the UI, from the user's settings and the cover of what is playing. Every
// colour derived here keeps text readable (WCAG AA, 4.5:1) whatever accent or cover it starts
// from: text sits on glass, and the glass is never lighter than WORST_SURFACE.
import type { Schemas } from "../api/base";
import {
  clamp,
  contrast,
  fromOklch,
  luminance,
  over,
  parseHex,
  toHex,
  toOklch,
  type Rgb,
} from "./color";

type CoverPalette = Schemas["CoverPalette"];

export const DEFAULT_ACCENT = "#6e56f8";

/** The backdrop of the sign-in screens. Brighter than the app's: there is just one small card
 * over it, in the middle, away from the brightest spots. */
export const SIGN_IN_AMBIENT = ["#6e56f8", "#ff5f9e", "#22c3e6"] as const;

/** Accents offered in the settings. Each reads under white text as is. */
export const ACCENT_PRESETS = [
  { id: "violet", color: "#6e56f8" },
  { id: "blue", color: "#2563eb" },
  { id: "teal", color: "#0f766e" },
  { id: "green", color: "#15803d" },
  { id: "amber", color: "#b45309" },
  { id: "red", color: "#dc2626" },
  { id: "pink", color: "#db2777" },
  { id: "graphite", color: "#52525b" },
] as const;

// Mirrors of the tokens in global.css (a test keeps them in sync).
export const BG = "#0d0e12";
export const GLASS = "#1c1d24";
export const GLASS_ALPHA = 0.6;
export const TEXT = "#f4f4f7";
export const TEXT_MUTED = "#c0c1c8";
export const DANGER = "#ffa2a9";
export const SUCCESS = "#4ade80";
export const INK = "#0d0e12";
const WHITE: Rgb = [255, 255, 255];

// The backdrop: three soft colour fields over BG, each at most AMBIENT_ALPHA opaque.
export const AMBIENT_ALPHA = [0.55, 0.4, 0.3] as const;
// No backdrop colour is lighter than this (relative luminance), so glass over it stays dark.
export const AMBIENT_MAX_LUMINANCE = 0.2;
const AMBIENT_MIN_LIGHTNESS = 0.3;
const AMBIENT_MAX_CHROMA = 0.17;
// The lightest a hovered or selected row on the glass gets (white at this alpha).
export const HIGHLIGHT_ALPHA = 0.08;
// The cover's colour behind an album's or artist's header, over the glass: as strong as it
// gets without making the glass lighter than a highlighted row (a test checks).
export const TINT_ALPHA = 0.2;

/** The lightest surface text can end up on: glass over the brightest backdrop allowed, where
 * all three colour fields overlap, with a row highlight on top. */
export const WORST_SURFACE: Rgb = (() => {
  const field = greyOf(AMBIENT_MAX_LUMINANCE);
  const backdrop = AMBIENT_ALPHA.reduce<Rgb>(
    (under, alpha) => over(field, alpha, under),
    parseHex(BG),
  );
  return over(WHITE, HIGHLIGHT_ALPHA, over(parseHex(GLASS), GLASS_ALPHA, backdrop));
})();

export interface AccentTokens {
  /** Fill of primary buttons and switches. */
  accent: string;
  accentHover: string;
  /** Text and icons on the fill. */
  accentOn: string;
  /** The accent as text, icons and focus rings on glass. */
  accentText: string;
}

export function accentTokens(hex: string): AccentTokens {
  const base = parseHex(hex);
  const ink = parseHex(INK);
  // White text unless dark text reads better on this colour.
  const on = contrast(WHITE, base) >= contrast(ink, base) ? WHITE : ink;
  const away = on === WHITE ? -1 : 1; // darker under white text, lighter under dark
  const fill = shiftUntil(base, away, (c) => contrast(on, c) >= 4.5);
  return {
    accent: toHex(fill),
    accentHover: toHex(shift(fill, 0.05 * away)),
    accentOn: toHex(on),
    accentText: toHex(shiftUntil(base, 1, (c) => contrast(c, WORST_SURFACE) >= 4.5)),
  };
}

/** The three backdrop colours: the cover's when one is given, else shades around the accent. */
export function ambientColors(
  accent: string,
  palette: CoverPalette | null,
): [string, string, string] {
  if (palette) {
    const first = palette.vibrant ?? palette.dominant;
    const second = palette.dominant !== first ? palette.dominant : palette.average;
    return [first, second, palette.muted].map((c) => toHex(ambientTone(parseHex(c)))) as [
      string,
      string,
      string,
    ];
  }
  const { c, h } = toOklch(parseHex(accent));
  // A grey accent gets a grey backdrop; a colour gets fields vivid enough to tint the glass.
  const chroma = c < 0.04 ? c : Math.max(c, 0.12);
  // Hue steps that turn the default violet into the pink and cyan of the sign-in screen.
  return [0, 76, -65].map((step) =>
    toHex(ambientTone(fromOklch({ l: 0.6, c: chroma, h: h + step }))),
  ) as [string, string, string];
}

/** The colour that tints the header of an album or artist page: the cover's, calmed like the
 * backdrop's. Drawn at TINT_ALPHA. */
export function coverTint(palette: CoverPalette): string {
  return toHex(ambientTone(parseHex(palette.vibrant ?? palette.dominant)));
}

/** A colour calm and dark enough for the backdrop, with its hue kept. */
export function ambientTone(rgb: Rgb): Rgb {
  const { l, c, h } = toOklch(rgb);
  const tone = { l: Math.max(l, AMBIENT_MIN_LIGHTNESS), c: Math.min(c, AMBIENT_MAX_CHROMA), h };
  let color = fromOklch(tone);
  while (luminance(color) > AMBIENT_MAX_LUMINANCE) {
    tone.l -= 0.005;
    color = fromOklch(tone);
  }
  return color;
}

function shift(rgb: Rgb, by: number): Rgb {
  const lch = toOklch(rgb);
  return fromOklch({ ...lch, l: clamp(lch.l + by, 0, 1) });
}

/** `rgb` made lighter (direction 1) or darker (-1) in small steps until `ok` holds. */
function shiftUntil(rgb: Rgb, direction: 1 | -1, ok: (color: Rgb) => boolean): Rgb {
  const lch = toOklch(rgb);
  let color = rgb;
  for (let l = lch.l; !ok(color) && l >= 0 && l <= 1; l += 0.01 * direction) {
    color = fromOklch({ ...lch, l: clamp(l, 0, 1) });
  }
  return ok(color) ? color : direction === 1 ? WHITE : [0, 0, 0];
}

function greyOf(targetLuminance: number): Rgb {
  const linear = targetLuminance;
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return [c * 255, c * 255, c * 255];
}
