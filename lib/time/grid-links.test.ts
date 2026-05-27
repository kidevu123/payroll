import { describe, expect, it } from "vitest";
import { resolveTimeCellPeriodId, safeLocalReturnTo } from "./grid-links";

describe("resolveTimeCellPeriodId", () => {
  it("uses the actual punch period for All-tab cells", () => {
    expect(
      resolveTimeCellPeriodId({
        currentPeriodId: "all-selected-period",
        isAllTab: true,
        punches: [
          {
            periodId: "semi-monthly-period",
            clockIn: new Date("2026-05-26T14:01:00.000Z"),
          },
        ],
      }),
    ).toBe("semi-monthly-period");
  });

  it("keeps the selected period for empty cells and schedule-specific tabs", () => {
    expect(
      resolveTimeCellPeriodId({
        currentPeriodId: "weekly-period",
        isAllTab: true,
        punches: [],
      }),
    ).toBe("weekly-period");

    expect(
      resolveTimeCellPeriodId({
        currentPeriodId: "weekly-period",
        isAllTab: false,
        punches: [
          {
            periodId: "other-period",
            clockIn: "2026-05-26T14:01:00.000Z",
          },
        ],
      }),
    ).toBe("weekly-period");
  });
});

describe("safeLocalReturnTo", () => {
  it("accepts only app-local return paths", () => {
    expect(safeLocalReturnTo("/time?period=abc", "/time")).toBe(
      "/time?period=abc",
    );
    expect(safeLocalReturnTo("https://evil.test/time", "/time")).toBe("/time");
    expect(safeLocalReturnTo("//evil.test/time", "/time")).toBe("/time");
    expect(safeLocalReturnTo(undefined, "/time")).toBe("/time");
  });
});
