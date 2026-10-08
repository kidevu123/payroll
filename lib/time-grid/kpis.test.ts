
import { describe, expect, it } from "vitest";
import { computeGridKpis, fmtHm, mobileSummaryLine } from "./kpis";
import { cellStateFor, type CellState } from "./cell-state";

const tz = "America/New_York";
const at = (s: string) => new Date(s);
const p = (employeeId: string, i: string, o: string | null) => ({ employeeId, clockIn: at(i), clockOut: o ? at(o) : null });
const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"];
const employees = [{ id: "a", status: "ACTIVE" }, { id: "b", status: "ACTIVE" }, { id: "c", status: "ACTIVE" }];
const punches = [
  p("a", "2026-10-05T13:00:00Z", "2026-10-05T21:00:00Z"), // 8h Mon
  p("a", "2026-10-06T13:00:00Z", null),                   // open today
  p("b", "2026-10-05T13:00:00Z", "2026-10-06T05:00:00Z"), // 16h Mon (long)
  p("b", "2026-10-06T13:00:00Z", "2026-10-06T21:00:00Z"), // 8h today
  p("c", "2026-10-05T13:00:00Z", null),                   // stale open from yesterday
];
const byCell = new Map<string, typeof punches>();
for (const x of punches) { const k = `${x.employeeId}|${x.clockIn.toISOString().slice(0, 10)}`; byCell.set(k, [...(byCell.get(k) ?? []), x]); }
const cellState = (e: string, d: string): CellState =>
  cellStateFor({ punches: byCell.get(`${e}|${d}`) ?? [], offType: undefined, dayIso: d, today: "2026-10-06", employeeActive: true });

describe("computeGridKpis", () => {
  const k = computeGridKpis({ punches, employees, days, today: "2026-10-06", tz, cellState });
  it("sums closed minutes and splits overtime at 40h per employee", () => {
    expect(k.totalMinutes).toBe(32 * 60);
    expect(k.regularMin).toBe(32 * 60);
    expect(k.overtimeMin).toBe(0);
  });
  it("flags overtime risk at 35h+ (87.5% of 40)", () => {
    expect(k.overtimeRisk).toBe(0);
    const heavy = computeGridKpis({ punches: [p("a", "2026-10-05T00:00:00Z", "2026-10-06T12:00:00Z")], employees, days, today: "2026-10-06", tz, cellState });
    expect(heavy.overtimeRisk).toBe(1);
  });
  it("counts who clocked in today and the open shifts started today", () => {
    expect(k.clockedInToday).toBe(2);
    expect(k.teamSize).toBe(3);
    expect(k.teamPct).toBe(67);
    expect(k.openNow).toBe(1);
  });
  it("counts stale open punches from before today", () => {
    expect(k.staleOpenPunchCount).toBe(1);
  });
  it("buckets today's summary from the cell states", () => {
    expect(k.todaySummary).toEqual({ present: 1, incomplete: 1, missing: 1, timeOff: 0, unpaid: 0 });
    expect(k.summaryTotal).toBe(3);
  });
  it("hours by day feeds the sparkline", () => {
    expect(k.hoursByDay[0]).toBe(24);
    expect(k.hoursByDay[1]).toBe(8);
    expect(k.hoursByDay.length).toBe(7);
  });
  it("issues by day marks past days with an incomplete cell and never today", () => {
    expect(k.issuesByDay.get("2026-10-05")).toBe(1);
    expect(k.issuesByDay.get("2026-10-06")).toBe(0);
  });
});

describe("fmtHm / mobileSummaryLine", () => {
  it("formats hours and minutes", () => {
    expect(fmtHm(950.5 * 60)).toBe("950h 30m");
    expect(fmtHm(0)).toBe("0h 0m");
  });
  it("lists only the non-zero buckets", () => {
    expect(mobileSummaryLine(["complete", "complete", "missed", "pto"])).toBe("2 complete · 1 missing · 1 off");
    expect(mobileSummaryLine([])).toBe("");
  });
});
