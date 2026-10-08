import { afterEach, describe, expect, it, vi } from "vitest";
import { isIOSSafari, isStandalonePWA } from "./platform";

afterEach(() => vi.unstubAllGlobals());
const nav = (o: Record<string, unknown>) => vi.stubGlobal("navigator", o);

describe("isIOSSafari", () => {
  it("false on the server (no navigator)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(isIOSSafari()).toBe(false);
  });
  it("true for an iPhone user agent", () => {
    nav({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", platform: "iPhone" });
    expect(isIOSSafari()).toBe(true);
  });
  it("true for an iPad that reports itself as a Mac but has a touch screen", () => {
    nav({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 });
    expect(isIOSSafari()).toBe(true);
  });
  it("false for a real Mac and for Android", () => {
    nav({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 });
    expect(isIOSSafari()).toBe(false);
    nav({ userAgent: "Mozilla/5.0 (Linux; Android 14)", platform: "Linux armv8l", maxTouchPoints: 5 });
    expect(isIOSSafari()).toBe(false);
  });
});

describe("isStandalonePWA", () => {
  const win = (matches: boolean) => vi.stubGlobal("window", { matchMedia: () => ({ matches }) });
  it("false on the server (no window)", () => {
    vi.stubGlobal("window", undefined);
    expect(isStandalonePWA()).toBe(false);
  });
  it("true when iOS says the app was launched from the home screen", () => {
    win(false); nav({ standalone: true });
    expect(isStandalonePWA()).toBe(true);
  });
  it("otherwise follows the display-mode media query", () => {
    nav({});
    win(true); expect(isStandalonePWA()).toBe(true);
    win(false); expect(isStandalonePWA()).toBe(false);
  });
});
