// Derive a full 10-stop brand ramp from the single owner-chosen hex.
//
// Why this exists: the root layout used to override ONLY `--color-brand-700`
// from Setting('company.brandColorHex'). Every other shade (50/100/200/300/
// 400/500/600/800/900) stayed the compiled-in emerald, so an owner brand
// color that wasn't emerald split the UI across two color families — a
// primary button rendered in the owner's color but its hover state in
// emerald, accent rails in one, chip tints in the other. Deriving the whole
// ramp from one anchor keeps the app on a single accent.
//
// Method: work in OKLCH (perceptually uniform, so tints/shades keep their
// hue instead of drifting the way naive RGB blending does). The owner's hex
// is pinned to the 700 stop exactly — that's the CTA color they picked and
// they should get it byte-for-byte. The remaining stops reuse the lightness
// and chroma SHAPE of the hand-tuned emerald ramp, scaled proportionally so
// any hue produces a family with the same feel.

/** Lightness of each stop in the reference emerald ramp (measured, OKLCH L). */
const REF_L: Record<BrandStop, number> = {
  50: 0.979, 100: 0.9488, 200: 0.8981, 300: 0.826, 400: 0.7407,
  500: 0.6481, 600: 0.5582, 700: 0.482, 800: 0.4146, 900: 0.3639,
};

/** Chroma of each stop relative to the 700 stop in the reference ramp. */
const REF_C_RATIO: Record<BrandStop, number> = {
  50: 0.2006, 100: 0.4602, 200: 0.8191, 300: 1.2127, 400: 1.4592,
  500: 1.4133, 600: 1.2259, 700: 1, 800: 0.8275, 900: 0.6935,
};

export const BRAND_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type BrandStop = (typeof BRAND_STOPS)[number];

const ANCHOR: BrandStop = 700;

type Oklch = { l: number; c: number; h: number };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

const linearToSrgb = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

/** Parse #rgb / #rrggbb. Returns null on anything else. */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let body = m[1]!;
  if (body.length === 3) {
    body = body
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  const n = parseInt(body, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function hexToOklch(hex: string): Oklch | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  return { l: L, c: Math.hypot(a, bb), h: Math.atan2(bb, a) };
}

function oklchToRgb({ l, c, h }: Oklch): { r: number; g: number; b: number } {
  const a = c * Math.cos(h);
  const bb = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return {
    r: 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    g: -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    b: -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  };
}

const inGamut = (rgb: { r: number; g: number; b: number }): boolean =>
  rgb.r >= -1e-4 && rgb.r <= 1.0001 &&
  rgb.g >= -1e-4 && rgb.g <= 1.0001 &&
  rgb.b >= -1e-4 && rgb.b <= 1.0001;

/**
 * OKLCH -> #rrggbb, reducing chroma until the color fits sRGB. Clipping the
 * channels instead would shift hue on saturated stops.
 */
export function oklchToHex(color: Oklch): string {
  let c = color.c;
  let rgb = oklchToRgb({ ...color, c });
  for (let i = 0; i < 24 && !inGamut(rgb); i += 1) {
    c *= 0.95;
    rgb = oklchToRgb({ ...color, c });
  }
  const to255 = (v: number): string =>
    Math.round(clamp01(linearToSrgb(clamp01(v))) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to255(rgb.r)}${to255(rgb.g)}${to255(rgb.b)}`;
}

/**
 * Build the full ramp from one hex. The input lands on stop 700 unchanged;
 * lighter stops interpolate toward white and darker stops toward black using
 * the reference ramp's proportions, so a bright or dark brand color still
 * yields a usable family instead of clipping.
 */
export function buildBrandRamp(hex: string): Record<BrandStop, string> | null {
  const base = hexToOklch(hex);
  if (!base) return null;

  const refAnchorL = REF_L[ANCHOR];
  const headroom = 1 - base.l;
  const refHeadroom = 1 - refAnchorL;

  const out = {} as Record<BrandStop, string>;
  for (const stop of BRAND_STOPS) {
    if (stop === ANCHOR) {
      // Pin the owner's exact color. Round-tripping through OKLCH would
      // shift it by a digit or two, and this is the color they picked.
      out[stop] = normalizeHex(hex);
      continue;
    }
    const refL = REF_L[stop];
    const l =
      refL >= refAnchorL
        ? base.l + ((refL - refAnchorL) / refHeadroom) * headroom
        : base.l * (refL / refAnchorL);
    out[stop] = oklchToHex({
      l: clamp01(l),
      c: base.c * REF_C_RATIO[stop],
      h: base.h,
    });
  }
  return out;
}

/** "#ABC" / "ABCDEF" -> "#abcdef". Returns the input unchanged if unparseable. */
export function normalizeHex(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const to255 = (v: number): string =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to255(rgb.r)}${to255(rgb.g)}${to255(rgb.b)}`;
}

/**
 * CSS custom properties for the derived ramp, ready to spread into a React
 * `style` prop on the document root.
 *
 * Scope rule: the brand ramp owns CHROME (nav, CTAs, accent rails, chips).
 * The `--dash-*` family stays put because it carries data-visualization
 * SEMANTICS (emerald = money, rose = problems, amber = pending) and flips
 * lightness between light and dark mode; rewriting it from the brand would
 * invert those flips and make one theme muddy.
 */
export function brandRampStyle(hex: string | null | undefined): Record<string, string> | undefined {
  if (!hex) return undefined;
  const ramp = buildBrandRamp(hex);
  if (!ramp) return undefined;
  const style: Record<string, string> = {};
  for (const stop of BRAND_STOPS) {
    style[`--color-brand-${stop}`] = ramp[stop];
  }
  return style;
}
