import { describe, expect, it } from "vitest";
import {
  inferAmbiguousOnFileRole,
  validateAmbiguousPair,
} from "./missing-punch";

describe("inferAmbiguousOnFileRole", () => {
  it("defaults morning punches to clock-in", () => {
    const at = new Date("2026-06-05T11:00:00Z"); // 7:00 AM ET
    expect(inferAmbiguousOnFileRole(at, "America/New_York")).toBe("clock-in");
  });

  it("defaults afternoon punches to clock-out", () => {
    const at = new Date("2026-06-05T22:11:00Z"); // 6:11 PM ET
    expect(inferAmbiguousOnFileRole(at, "America/New_York")).toBe("clock-out");
  });
});

describe("validateAmbiguousPair", () => {
  const tz = "America/New_York";
  const onFileAt = new Date("2026-06-05T22:11:00Z"); // 6:11 PM ET
  const label = () => "6:11 PM";

  it("rejects morning time in clock-out field when on-file is clock-in", () => {
    expect(
      validateAmbiguousPair(
        "clock-in",
        "2026-06-05T18:11",
        "2026-06-05T06:00",
        tz,
        onFileAt,
        label,
      ),
    ).toMatch(/select Clock out/i);
  });

  it("accepts clock-out after on-file clock-in", () => {
    expect(
      validateAmbiguousPair(
        "clock-in",
        "2026-06-05T18:11",
        "2026-06-05T22:30",
        tz,
        onFileAt,
        label,
      ),
    ).toBeNull();
  });

  it("accepts morning clock-in when on-file is clock-out", () => {
    expect(
      validateAmbiguousPair(
        "clock-out",
        "2026-06-05T18:11",
        "2026-06-05T06:00",
        tz,
        onFileAt,
        label,
      ),
    ).toBeNull();
  });
});
