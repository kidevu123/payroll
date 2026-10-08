import { describe, expect, it } from "vitest";
import { TYPE_COLORS, TYPE_LABEL, eachDayBetween, endOfMonth, isoDay, nameFromMap, pad2, startOfMonth } from "./calendar-grid";

describe("calendar grid helpers", () => {
  it("pads to two digits", () => {
    expect(pad2(5)).toBe("05");
    expect(pad2(12)).toBe("12");
  });
  it("month bounds in UTC, including a leap February and a year end", () => {
    expect(isoDay(startOfMonth(2026, 9))).toBe("2026-10-01");
    expect(isoDay(endOfMonth(2026, 9))).toBe("2026-10-31");
    expect(isoDay(endOfMonth(2028, 1))).toBe("2028-02-29");
    expect(isoDay(endOfMonth(2026, 11))).toBe("2026-12-31");
  });
  it("lists each day inclusively across a month end", () => {
    expect(eachDayBetween("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(eachDayBetween("2026-10-05", "2026-10-05")).toEqual(["2026-10-05"]);
  });
  it("names an employee, or Unknown", () => {
    const m = new Map([["a", "Ava"]]);
    expect(nameFromMap(m, "a")).toBe("Ava");
    expect(nameFromMap(m, "zzz")).toBe("Unknown");
  });
  it("has a label and a colour for every time-off type", () => {
    expect(TYPE_LABEL).toEqual({ PERSONAL: "PTO", SICK: "Sick", UNPAID: "Unpaid", OTHER: "Other", SCHEDULE_NOTE: "Note" });
    expect(Object.keys(TYPE_COLORS).sort()).toEqual(Object.keys(TYPE_LABEL).sort());
  });
});
