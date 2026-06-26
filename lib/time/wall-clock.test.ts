import { describe, expect, it } from "vitest";
import { wallClockToUtc } from "./wall-clock";

const TZ = "America/New_York";
const iso = (s: string) => wallClockToUtc(s, TZ)?.toISOString();

describe("wallClockToUtc", () => {
  it("EDT summer: -04:00", () => {
    expect(iso("2026-06-15T16:52:47")).toBe("2026-06-15T20:52:47.000Z");
  });

  it("EST winter: -05:00", () => {
    expect(iso("2026-01-15T09:00:00")).toBe("2026-01-15T14:00:00.000Z");
  });

  it("spring-forward day, after the 02:00->03:00 jump, resolves as EDT (-04:00) not EST", () => {
    // The bug: offset evaluated at the candidate gave EST and landed this an
    // hour late at 08:30Z. Correct is 03:30 EDT = 07:30Z.
    expect(iso("2026-03-08T03:30:00")).toBe("2026-03-08T07:30:00.000Z");
  });

  it("spring-forward day, before the jump, resolves as EST (-05:00)", () => {
    expect(iso("2026-03-08T01:30:00")).toBe("2026-03-08T06:30:00.000Z");
  });

  it("fall-back day, after the 02:00->01:00 jump, resolves as EST (-05:00)", () => {
    expect(iso("2026-11-01T03:00:00")).toBe("2026-11-01T08:00:00.000Z");
  });

  it("returns null on malformed input", () => {
    expect(wallClockToUtc("not-a-date", TZ)).toBeNull();
  });
});
