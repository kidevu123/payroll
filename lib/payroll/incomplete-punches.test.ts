import { describe, expect, it } from "vitest";
import {
  incompletePunchFixHref,
  listIncompletePunches,
} from "./incomplete-punches";

const TZ = "America/New_York";
const todayStart = new Date("2026-10-13T04:00:00Z"); // Oct 13, 00:00 ET
const names = new Map([
  ["e1", "Maria Espinoza"],
  ["e2", "Dela Hernadez"],
]);

describe("listIncompletePunches", () => {
  it("returns an open punch from an earlier day with who and when", () => {
    const list = listIncompletePunches({
      punches: [
        { id: "p1", employeeId: "e2", clockIn: new Date("2026-10-08T14:20:00Z"), clockOut: null },
      ],
      employeeNames: names,
      timezone: TZ,
      todayStart,
    });
    expect(list).toEqual([
      {
        punchId: "p1",
        employeeId: "e2",
        employeeName: "Dela Hernadez",
        day: "2026-10-08",
        clockIn: new Date("2026-10-08T14:20:00Z"),
      },
    ]);
  });

  it("uses the company day, not the UTC day, for a late-evening punch", () => {
    const [p] = listIncompletePunches({
      punches: [
        { id: "p1", employeeId: "e1", clockIn: new Date("2026-10-09T01:30:00Z"), clockOut: null },
      ],
      employeeNames: names,
      timezone: TZ,
      todayStart,
    });
    expect(p?.day).toBe("2026-10-08");
  });

  it("skips completed, voided and still-running shifts", () => {
    const list = listIncompletePunches({
      punches: [
        { id: "done", employeeId: "e1", clockIn: new Date("2026-10-08T14:00:00Z"), clockOut: new Date("2026-10-08T22:00:00Z") },
        { id: "void", employeeId: "e1", clockIn: new Date("2026-10-08T14:00:00Z"), clockOut: null, voidedAt: new Date() },
        { id: "today", employeeId: "e1", clockIn: new Date("2026-10-13T14:00:00Z"), clockOut: null },
      ],
      employeeNames: names,
      timezone: TZ,
      todayStart,
    });
    expect(list).toEqual([]);
  });

  it("still lists a punch whose employee is not on file", () => {
    const [p] = listIncompletePunches({
      punches: [{ id: "p1", employeeId: "gone", clockIn: "2026-10-08T14:00:00Z", clockOut: null }],
      employeeNames: names,
      timezone: TZ,
      todayStart,
    });
    expect(p?.employeeName).toBe("Unknown employee");
  });

  it("orders by day, then by name", () => {
    const list = listIncompletePunches({
      punches: [
        { id: "a", employeeId: "e1", clockIn: new Date("2026-10-09T14:00:00Z"), clockOut: null },
        { id: "b", employeeId: "e1", clockIn: new Date("2026-10-08T14:00:00Z"), clockOut: null },
        { id: "c", employeeId: "e2", clockIn: new Date("2026-10-08T15:00:00Z"), clockOut: null },
      ],
      employeeNames: names,
      timezone: TZ,
      todayStart,
    });
    expect(list.map((p) => p.punchId)).toEqual(["c", "b", "a"]);
  });
});

describe("incompletePunchFixHref", () => {
  it("points at the day editor for that employee", () => {
    expect(incompletePunchFixHref("per-1", { day: "2026-10-08", employeeId: "e2" })).toBe(
      "/time/per-1/2026-10-08/e2",
    );
  });
});
