import { describe, expect, it } from "vitest";
import { buildTimeOffByDay, groupPunchesByCell } from "./grid-data";

describe("buildTimeOffByDay", () => {
  it("expands a multi-day request into one entry per day, inclusive", () => {
    const m = buildTimeOffByDay([
      { employeeId: "a", startDate: "2026-10-05", endDate: "2026-10-07", type: "SICK" },
    ]);
    expect([...m.keys()]).toEqual(["a|2026-10-05", "a|2026-10-06", "a|2026-10-07"]);
    expect(m.get("a|2026-10-06")).toBe("SICK");
  });
  it("skips schedule notes: they are a heads-up, not time off", () => {
    const m = buildTimeOffByDay([
      { employeeId: "a", startDate: "2026-10-05", endDate: "2026-10-05", type: "SCHEDULE_NOTE" },
    ]);
    expect(m.size).toBe(0);
  });
  it("a later request for the same day wins", () => {
    const m = buildTimeOffByDay([
      { employeeId: "a", startDate: "2026-10-05", endDate: "2026-10-05", type: "SICK" },
      { employeeId: "a", startDate: "2026-10-05", endDate: "2026-10-05", type: "PERSONAL" },
    ]);
    expect(m.get("a|2026-10-05")).toBe("PERSONAL");
  });
});

describe("groupPunchesByCell", () => {
  const tz = "America/New_York";
  const p = (id: string, employeeId: string, i: string, o: string | null) => ({
    id, employeeId, clockIn: new Date(i), clockOut: o ? new Date(o) : null,
  });
  it("groups by employee and by the clock-in day in the company timezone", () => {
    // 03:30Z on the 6th is 23:30 on the 5th in New York.
    const g = groupPunchesByCell([p("1", "a", "2026-10-06T03:30:00Z", "2026-10-06T05:00:00Z")], ["a"], tz);
    expect([...g.get("a")!.keys()]).toEqual(["2026-10-05"]);
  });
  it("drops punches for employees that are not on the grid", () => {
    const g = groupPunchesByCell([p("1", "zzz", "2026-10-05T13:00:00Z", null)], ["a"], tz);
    expect(g.get("a")!.size).toBe(0);
    expect(g.has("zzz")).toBe(false);
  });
  it("collapses near-duplicate punches in a cell to one", () => {
    const g = groupPunchesByCell(
      [
        p("1", "a", "2026-10-05T13:00:00Z", "2026-10-05T21:00:00Z"),
        p("2", "a", "2026-10-05T13:00:20Z", "2026-10-05T21:00:10Z"),
      ],
      ["a"],
      tz,
    );
    expect(g.get("a")!.get("2026-10-05")!.length).toBe(1);
  });
});
