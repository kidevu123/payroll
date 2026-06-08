import { describe, expect, it } from "vitest";
import {
  buildTimeEditorHref,
  resolveTimeCellPeriodId,
  safeLocalReturnTo,
} from "./grid-links";

describe("resolveTimeCellPeriodId", () => {
  it("uses the punch period when punches exist", () => {
    expect(
      resolveTimeCellPeriodId({
        currentPeriodId: "weekly-selected-period",
        punches: [
          {
            periodId: "semi-monthly-period",
            clockIn: new Date("2026-05-26T14:01:00.000Z"),
          },
        ],
      }),
    ).toBe("semi-monthly-period");
  });

  it("keeps the selected period for empty cells", () => {
    expect(
      resolveTimeCellPeriodId({
        currentPeriodId: "weekly-period",
        punches: [],
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

describe("buildTimeEditorHref", () => {
  it("keeps safe return context attached to the punch editor route", () => {
    expect(
      buildTimeEditorHref({
        periodId: "period-1",
        date: "2026-05-26",
        employeeId: "employee-1",
        returnTo: "/payroll/period-1",
      }),
    ).toBe(
      "/time/period-1/2026-05-26/employee-1?returnTo=%2Fpayroll%2Fperiod-1",
    );
  });

  it("drops unsafe return context instead of preserving external URLs", () => {
    expect(
      buildTimeEditorHref({
        periodId: "period-1",
        date: "2026-05-26",
        employeeId: "employee-1",
        returnTo: "https://evil.test/payroll",
      }),
    ).toBe("/time/period-1/2026-05-26/employee-1");
  });
});
