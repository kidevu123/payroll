import { describe, expect, it } from "vitest";
import { KIND_LABEL, centsToInput, formatMoney, formatRange } from "./upload-format";
import { normalizeDateForGuess } from "@/lib/punches/normalize-date";

describe("formatRange", () => {
  it("prints the year once within a year, twice across one", () => {
    expect(formatRange("2026-08-01", "2026-08-31")).toBe("Aug 1 – Aug 31, 2026");
    expect(formatRange("2025-12-16", "2026-01-15")).toBe("Dec 16, 2025 – Jan 15, 2026");
  });
  it("is null when either end is missing", () => {
    expect(formatRange(null, "2026-08-31")).toBeNull();
    expect(formatRange("2026-08-01", null)).toBeNull();
  });
});

describe("money", () => {
  it("formats cents as dollars", () => {
    expect(formatMoney(412345)).toBe("$4,123.45");
    expect(formatMoney(0)).toBe("$0.00");
  });
  it("pre-fills the net input from cents", () => {
    expect(centsToInput(214320)).toBe("2143.20");
    expect(centsToInput(5)).toBe("0.05");
  });
  it("labels each document kind", () => {
    expect(KIND_LABEL).toEqual({ PAYSTUB: "Paystub", W2: "W2", OTHER: "Other" });
  });
});

describe("normalizeDateForGuess", () => {
  it("keeps an ISO date and trims a timestamp to its day", () => {
    expect(normalizeDateForGuess(" 2026-10-05 ")).toBe("2026-10-05");
    expect(normalizeDateForGuess("2026-10-05T13:00:00Z")).toBe("2026-10-05");
  });
  it("reads US dates, padding and expanding a two-digit year", () => {
    expect(normalizeDateForGuess("10/5/2026")).toBe("2026-10-05");
    expect(normalizeDateForGuess("1/2/26")).toBe("2026-01-02");
  });
  it("is null for anything else", () => {
    expect(normalizeDateForGuess("Oct 5")).toBeNull();
    expect(normalizeDateForGuess("")).toBeNull();
  });
});
