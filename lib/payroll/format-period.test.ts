import { describe, expect, it } from "vitest";
import { formatPeriodRange } from "./format-period";

describe("formatPeriodRange", () => {
  it("prints the year once when the range stays inside it", () => {
    expect(formatPeriodRange("2026-08-03", "2026-08-09")).toBe(
      "Aug 03 – Aug 09, 2026",
    );
  });

  it("prints both years when the range crosses a boundary", () => {
    expect(formatPeriodRange("2025-12-29", "2026-01-04")).toBe(
      "Dec 29, 2025 – Jan 04, 2026",
    );
  });

  it("zero-pads single-digit days", () => {
    expect(formatPeriodRange("2026-03-01", "2026-03-07")).toBe(
      "Mar 01 – Mar 07, 2026",
    );
  });

  it("does not shift the day for timezones behind UTC", () => {
    // Parsed at noon UTC — a naive midnight parse renders Aug 02 in ET.
    expect(formatPeriodRange("2026-08-03", "2026-08-03")).toContain("Aug 03");
  });

  it("falls back rather than throwing on bad input", () => {
    expect(formatPeriodRange("", "2026-08-09")).toBe("—");
    expect(formatPeriodRange("nonsense", "also-bad")).toBe("nonsense – also-bad");
  });
});
