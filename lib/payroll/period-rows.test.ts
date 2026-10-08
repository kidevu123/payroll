import { describe, expect, it } from "vitest";
import {
  buildDisplayRows,
  filterPeriodEmployees,
  groupPeriodPunches,
  signOffGroups,
  sumLiveTotals,
  sumStoredPayslips,
} from "./period-rows";

const emp = (id: string, over: Partial<{ payScheduleId: string | null; payType: string; displayName: string }> = {}) => ({
  id,
  displayName: over.displayName ?? id,
  payScheduleId: over.payScheduleId === undefined ? "weekly" : over.payScheduleId,
  payType: over.payType ?? "HOURLY",
});

describe("filterPeriodEmployees", () => {
  const all = [emp("a"), emp("b", { payScheduleId: "semi" }), emp("c", { payScheduleId: null }), emp("s", { payType: "SALARIED" })];
  it("cohort beats schedule: exactly the cohort, whatever their schedule", () => {
    expect(filterPeriodEmployees(all, { cohort: ["b", "c"], scheduleId: "weekly" }).map((e) => e.id)).toEqual(["b", "c"]);
  });
  it("schedule filter is an exact match; employees with no schedule are NOT included", () => {
    // The comment in the page said unassigned employees are wildcards; the
    // code has been an exact match. Pinned as the code behaves.
    expect(filterPeriodEmployees(all, { cohort: null, scheduleId: "weekly" }).map((e) => e.id)).toEqual(["a"]);
  });
  it("no cohort and no schedule: everyone", () => {
    expect(filterPeriodEmployees(all, { cohort: null, scheduleId: null }).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
  it("salaried staff are always excluded, even from a cohort", () => {
    expect(filterPeriodEmployees(all, { cohort: ["a", "s"], scheduleId: null }).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("groupPeriodPunches", () => {
  const p = (id: string, employeeId: string, i: string, o: string | null) => ({ id, employeeId, clockIn: new Date(i), clockOut: o ? new Date(o) : null });
  const punches = [
    p("1", "a", "2026-10-05T13:00:00Z", "2026-10-05T21:00:00Z"),
    p("2", "a", "2026-10-05T13:00:20Z", "2026-10-05T21:00:10Z"),
    p("3", "zzz", "2026-10-05T13:00:00Z", null),
  ];
  it("when restricted, drops punches of employees outside the list", () => {
    const g = groupPeriodPunches(punches, ["a"], true);
    expect([...g.keys()]).toEqual(["a"]);
  });
  it("when not restricted, keeps every employee's punches", () => {
    expect([...groupPeriodPunches(punches, ["a"], false).keys()].sort()).toEqual(["a", "zzz"]);
  });
  it("collapses near-duplicates per employee", () => {
    expect(groupPeriodPunches(punches, ["a"], true).get("a")!.length).toBe(1);
  });
});

const res = (hours: number, cents: number) => ({ totalHours: hours, grossCents: cents, roundedCents: cents, regularCents: cents, overtimeCents: 0, taskCents: 0, byDay: [] as unknown[] });
const slip = (employeeId: string, over: Record<string, unknown> = {}) => ({
  employeeId,
  voidedAt: null as Date | null,
  hoursWorked: "40.00" as string | number | null,
  grossPayCents: 88_000,
  roundedPayCents: 88_000,
  signedAt: null as Date | null,
  acknowledgedAt: null as Date | null,
  disputedAt: null as Date | null,
  disputeResolvedAt: null as Date | null,
  ...over,
});

describe("totals", () => {
  it("live totals sum hours, gross and rounded", () => {
    expect(sumLiveTotals([{ result: res(8, 100) }, { result: res(4, 50) }])).toEqual({ hours: 12, gross: 150, rounded: 150 });
  });
  it("stored totals ignore voided payslips and coerce hours", () => {
    expect(sumStoredPayslips([slip("a"), slip("b", { voidedAt: new Date(), roundedPayCents: 1 }), slip("c", { hoursWorked: null })])).toEqual({ sum: 176_000, hours: 40 });
  });
});

describe("buildDisplayRows", () => {
  const employees = [emp("a", { displayName: "Zed" }), emp("b", { displayName: "Amy" })];
  const rendered = [{ employee: employees[0]!, result: res(39.4, 80_000), incomplete: 1, punches: [{ id: "p" }] }];
  it("live: returns the computed rows untouched", () => {
    expect(buildDisplayRows({ rendered, payslips: [slip("a")], allEmployees: employees, useStored: false })).toBe(rendered);
  });
  it("stored totals: rows come from payslips, employees without a live row are appended, sorted by name", () => {
    const rows = buildDisplayRows({ rendered, payslips: [slip("a"), slip("b"), slip("ghost"), slip("a", { voidedAt: new Date() })], allEmployees: employees, useStored: true });
    expect(rows.map((r) => r.employee.displayName)).toEqual(["Amy", "Zed"]);
    const amy = rows[0]!;
    expect(amy.result).toMatchObject({ totalHours: 40, grossCents: 88_000, roundedCents: 88_000, regularCents: 0, byDay: [] });
    expect(amy.incomplete).toBe(0);
    expect(amy.punches).toEqual([]);
    const zed = rows[1]!;
    expect(zed.result.regularCents).toBe(80_000); // keeps the live breakdown
    expect(zed.incomplete).toBe(1);
    expect(zed.storedHours).toBe(40);
    expect(zed.liveHours).toBe(39.4);
  });
  it("drift threshold: flagged above 0.5h, not at exactly 0.5h", () => {
    const at = (live: number) => buildDisplayRows({ rendered: [{ ...rendered[0]!, result: res(live, 1) }], payslips: [slip("a")], allEmployees: employees, useStored: true })[0]!.hoursDrift;
    expect(at(39.5)).toBe(false);
    expect(at(39.4)).toBe(true);
    expect(at(40)).toBe(false);
  });
});

describe("signOffGroups", () => {
  const paying = (p: { roundedPayCents: number }) => p.roundedPayCents > 0;
  it("sign-off buckets: only paying, non-voided payslips count", () => {
    const g = signOffGroups([slip("a"), slip("z", { roundedPayCents: 0 }), slip("v", { voidedAt: new Date() })], paying);
    expect(g.active.map((p) => p.employeeId)).toEqual(["a"]);
    expect(g.pending.map((p) => p.employeeId)).toEqual(["a"]);
  });
  it("signed beats acknowledged; a disputed payslip is only in Disputed, even if acknowledged", () => {
    const t = new Date();
    const g = signOffGroups(
      [slip("signed", { signedAt: t, acknowledgedAt: t }), slip("ack", { acknowledgedAt: t }), slip("disp", { acknowledgedAt: t, disputedAt: t }), slip("pend")],
      paying,
    );
    expect(g.signed.map((p) => p.employeeId)).toEqual(["signed"]);
    expect(g.ackd.map((p) => p.employeeId)).toEqual(["ack"]);
    expect(g.disputed.map((p) => p.employeeId)).toEqual(["disp"]);
    expect(g.pending.map((p) => p.employeeId)).toEqual(["pend"]);
  });
  it("a resolved dispute is in no bucket (pinned as the page behaves)", () => {
    const t = new Date();
    const g = signOffGroups([slip("r", { disputedAt: t, disputeResolvedAt: t })], paying);
    expect([g.signed, g.ackd, g.disputed, g.pending].every((b) => b.length === 0)).toBe(true);
    expect(g.active.length).toBe(1);
  });
});
