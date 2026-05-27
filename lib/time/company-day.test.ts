import { describe, expect, it } from "vitest";
import { companyTodayIso } from "./company-day";

describe("companyTodayIso", () => {
  it("uses the company timezone instead of UTC day boundaries", () => {
    const lateEveningEastern = new Date("2026-05-23T02:30:00.000Z");

    expect(companyTodayIso(lateEveningEastern, "America/New_York")).toBe(
      "2026-05-22",
    );
    expect(companyTodayIso(lateEveningEastern, "UTC")).toBe("2026-05-23");
  });
});

