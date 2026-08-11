import { describe, expect, it } from "vitest";
import {
  BRAND_STOPS,
  brandRampStyle,
  buildBrandRamp,
  hexToOklch,
  normalizeHex,
  oklchToHex,
} from "./ramp";

describe("buildBrandRamp", () => {
  it("pins the owner's hex to stop 700 exactly", () => {
    expect(buildBrandRamp("#067049")?.[700]).toBe("#067049");
    expect(buildBrandRamp("#C2410C")?.[700]).toBe("#c2410c");
  });

  it("reproduces the designed emerald ramp within a small delta", () => {
    // The generator is seeded from this ramp's shape, so feeding it the
    // emerald anchor should return approximately the hand-tuned stops.
    const ramp = buildBrandRamp("#067049")!;
    const expected: Record<number, string> = {
      50: "#ecfdf4", 100: "#d2f9e4", 200: "#a9f0cb", 300: "#6fe0ab",
      400: "#34c886", 600: "#078a54", 800: "#085a3c", 900: "#084a33",
    };
    for (const [stop, hex] of Object.entries(expected)) {
      const got = hexToOklch(ramp[Number(stop) as (typeof BRAND_STOPS)[number]])!;
      const want = hexToOklch(hex)!;
      expect(Math.abs(got.l - want.l)).toBeLessThan(0.03);
      expect(Math.abs(got.c - want.c)).toBeLessThan(0.03);
    }
  });

  it("orders stops from lightest to darkest for any hue", () => {
    for (const hex of ["#067049", "#c2410c", "#2563eb", "#111111", "#f5d0a9"]) {
      const ramp = buildBrandRamp(hex)!;
      const lightness = BRAND_STOPS.map((s) => hexToOklch(ramp[s])!.l);
      for (let i = 1; i < lightness.length; i += 1) {
        expect(lightness[i]!).toBeLessThanOrEqual(lightness[i - 1]! + 1e-6);
      }
    }
  });

  it("keeps every derived stop inside sRGB", () => {
    for (const hex of ["#00ff00", "#ff0000", "#067049", "#0000ff"]) {
      const ramp = buildBrandRamp(hex)!;
      for (const stop of BRAND_STOPS) {
        expect(ramp[stop]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("holds hue steady across the ramp", () => {
    const ramp = buildBrandRamp("#c2410c")!;
    const baseHue = hexToOklch("#c2410c")!.h;
    for (const stop of [300, 500, 700, 900] as const) {
      const { h, c } = hexToOklch(ramp[stop])!;
      if (c < 0.02) continue; // hue is meaningless for near-greys
      expect(Math.abs(h - baseHue)).toBeLessThan(0.12);
    }
  });

  it("returns null for unparseable input", () => {
    expect(buildBrandRamp("not-a-color")).toBeNull();
    expect(buildBrandRamp("")).toBeNull();
  });

  it("accepts 3-digit shorthand", () => {
    expect(buildBrandRamp("#0f0")?.[700]).toBe("#00ff00");
  });
});

describe("brandRampStyle", () => {
  it("emits every brand stop", () => {
    const style = brandRampStyle("#067049")!;
    for (const stop of BRAND_STOPS) {
      expect(style[`--color-brand-${stop}`]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("leaves the data-viz token family alone", () => {
    // --dash-* carries chart semantics and flips lightness per theme; the
    // brand ramp must not rewrite it.
    const style = brandRampStyle("#c2410c")!;
    expect(Object.keys(style).every((k) => k.startsWith("--color-brand-"))).toBe(true);
  });

  it("is undefined when no brand color is configured", () => {
    expect(brandRampStyle(null)).toBeUndefined();
    expect(brandRampStyle(undefined)).toBeUndefined();
    expect(brandRampStyle("nope")).toBeUndefined();
  });
});

describe("hex helpers", () => {
  it("normalizes case and shorthand", () => {
    expect(normalizeHex("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHex("0f0")).toBe("#00ff00");
  });

  it("round-trips through OKLCH", () => {
    for (const hex of ["#067049", "#c2410c", "#ffffff", "#000000"]) {
      expect(oklchToHex(hexToOklch(hex)!)).toBe(hex);
    }
  });
});
