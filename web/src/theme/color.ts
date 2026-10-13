// Colour arithmetic for the theme: WCAG contrast, and OKLCH (perceptual lightness, chroma,
// hue) to make lighter or calmer shades of a colour without shifting its hue.

/** sRGB channels, 0–255. */
export type Rgb = readonly [number, number, number];

export interface Oklch {
  /** Lightness, 0 (black) to 1 (white). */
  l: number;
  /** Chroma: 0 is grey, about 0.37 the most vivid sRGB colours. */
  c: number;
  /** Hue angle in degrees. */
  h: number;
}

export function parseHex(hex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Not a #rrggbb colour: ${hex}`);
  const value = parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

export function toHex(rgb: Rgb): string {
  return `#${rgb
    .map((c) =>
      Math.round(clamp(c, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Each channel of `top` drawn with `alpha` over `bottom`, as browsers composite. */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const mix = (a: number, b: number) => a * alpha + b * (1 - alpha);
  return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2])];
}

/** WCAG relative luminance: 0 for black, 1 for white. */
export function luminance(rgb: Rgb): number {
  const [r, g, b] = linear(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. Text needs 4.5 (AA), large text and controls 3. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function toOklch(rgb: Rgb): Oklch {
  const [r, g, b] = linear(rgb);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

/** The sRGB colour for `lch`; out of gamut, the most vivid one of the same lightness and hue. */
export function fromOklch(lch: Oklch): Rgb {
  const l = clamp(lch.l, 0, 1);
  if (inGamut(oklchToLinear({ ...lch, l }))) return toRgb(oklchToLinear({ ...lch, l }));
  let [low, high] = [0, lch.c];
  for (let i = 0; i < 24; i++) {
    const c = (low + high) / 2;
    if (inGamut(oklchToLinear({ l, c, h: lch.h }))) low = c;
    else high = c;
  }
  return toRgb(oklchToLinear({ l, c: low, h: lch.h }));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(channels: [number, number, number]): boolean {
  return channels.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
}

function linear(rgb: Rgb): [number, number, number] {
  return [toLinear(rgb[0] / 255), toLinear(rgb[1] / 255), toLinear(rgb[2] / 255)];
}

function toRgb([r, g, b]: [number, number, number]): Rgb {
  const channel = (c: number) => Math.round(fromLinear(clamp(c, 0, 1)) * 255);
  return [channel(r), channel(g), channel(b)];
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}
