import { describe, expect, it } from "vitest";
import { buildPunchIso } from "./api-client";

describe("buildPunchIso (NGTeco punch time is never UTC)", () => {
  it("uses NGTeco's own offset when present", () => {
    // 16:52:47 -04:00 == 20:52:47Z
    const iso = buildPunchIso("2026-06-24", "16:52:47", "-04:00", "America/New_York");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).toISOString()).toBe("2026-06-24T20:52:47.000Z");
  });

  it("falls back to the company zone (EDT) when the offset is missing — NOT UTC", () => {
    // June -> EDT (-04:00). Wall-clock 16:52:47 ET == 20:52:47Z.
    const iso = buildPunchIso("2026-06-24", "16:52:47", "", "America/New_York");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).toISOString()).toBe("2026-06-24T20:52:47.000Z");
    // If it had been treated as UTC this would have been 16:52:47Z — wrong.
    expect(new Date(iso!).toISOString()).not.toBe("2026-06-24T16:52:47.000Z");
  });

  it("is DST-correct in winter (EST -05:00), not a hardcoded -04:00", () => {
    // January -> EST (-05:00). Wall-clock 09:00 ET == 14:00Z.
    const iso = buildPunchIso("2026-01-15", "09:00:00", "", "America/New_York");
    expect(iso).not.toBeNull();
    expect(new Date(iso!).toISOString()).toBe("2026-01-15T14:00:00.000Z");
    // Hardcoded -04:00 would have produced 13:00Z; UTC would have produced 09:00Z.
    expect(new Date(iso!).toISOString()).not.toBe("2026-01-15T13:00:00.000Z");
    expect(new Date(iso!).toISOString()).not.toBe("2026-01-15T09:00:00.000Z");
  });
});
