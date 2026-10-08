import { describe, expect, it } from "vitest";
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import {
  PAGE_SIZE,
  formatDate,
  groupByMonth,
  groupByPeriod,
  groupMethod,
  groupState,
  matchesFilters,
  monthGross,
  monthNet,
  pageNumbers,
  periodGross,
  periodNet,
} from "./table-model";

function row(over: Partial<ReportRow>): ReportRow {
  return {
    id: "r1",
    periodId: "p1",
    startDate: "2026-09-28",
    endDate: "2026-10-04",
    source: "MANUAL_UPLOAD" as ReportRow["source"],
    state: "PUBLISHED" as ReportRow["state"],
    scheduleName: "Weekly",
    amountCents: 100_000,
    grossPayCents: 100_000,
    docNetPayCents: 0,
    replacedRunNetCents: 0,
    tempLaborCents: 0,
    createdByDisplay: "Owner",
    postedAt: new Date("2026-10-05T12:00:00Z"),
    publishedToPortalAt: null,
    pdfPath: null,
    zohoPushes: [],
    periodState: "LOCKED",
    periodPaymentMethod: null,
    ...over,
  };
}

describe("groupByPeriod", () => {
  it("groups runs by period, keeps input order, and sums employees and hours", () => {
    const groups = groupByPeriod([
      row({ id: "a", periodId: "p2", startDate: "2026-10-05", employeesPaid: 10, hoursWorked: 400 }),
      row({ id: "b", periodId: "p1", employeesPaid: 5, hoursWorked: 200 }),
      row({ id: "c", periodId: "p2", startDate: "2026-10-05", employeesPaid: 2, hoursWorked: 80 }),
    ]);
    expect(groups.map((g) => g.periodId)).toEqual(["p2", "p1"]);
    expect(groups[0]!.runs.map((r) => r.id)).toEqual(["a", "c"]);
    expect(groups[0]!.employeesPaid).toBe(12);
    expect(groups[0]!.hoursWorked).toBe(480);
  });
  it("leaves employees and hours null when no run carries them", () => {
    const [g] = groupByPeriod([row({})]);
    expect(g!.employeesPaid).toBeNull();
    expect(g!.hoursWorked).toBeNull();
  });
  it("takes period metadata from the first run of the period", () => {
    const [g] = groupByPeriod([row({ id: "a", tempLaborCents: 500 }), row({ id: "b", tempLaborCents: 500 })]);
    expect(g!.tempLaborCents).toBe(500);
  });
});

describe("period and month totals", () => {
  it("net swaps the run net of paystub employees for the paystub net, plus temp labor once", () => {
    const [g] = groupByPeriod([
      row({ id: "a", amountCents: 100_000, docNetPayCents: 30_000, replacedRunNetCents: 40_000, tempLaborCents: 5_000 }),
      row({ id: "b", amountCents: 20_000, docNetPayCents: 30_000, replacedRunNetCents: 40_000, tempLaborCents: 5_000 }),
    ]);
    // 100,000 + 20,000 - 40,000 + 30,000 + 5,000
    expect(periodNet(g!)).toBe(115_000);
  });
  it("gross is the sum of run gross plus temp labor once", () => {
    const [g] = groupByPeriod([
      row({ id: "a", grossPayCents: 100_000, tempLaborCents: 5_000 }),
      row({ id: "b", grossPayCents: 20_000, tempLaborCents: 5_000 }),
    ]);
    expect(periodGross(g!)).toBe(125_000);
  });
  it("months keep newest-first order and total their periods", () => {
    const months = groupByMonth(
      groupByPeriod([
        row({ id: "a", periodId: "p3", startDate: "2026-10-05", amountCents: 1, grossPayCents: 2 }),
        row({ id: "b", periodId: "p2", startDate: "2026-09-28", amountCents: 10, grossPayCents: 20 }),
        row({ id: "c", periodId: "p1", startDate: "2026-09-21", amountCents: 100, grossPayCents: 200 }),
      ]),
    );
    expect(months.map((m) => [m.key, m.label, m.periods.length])).toEqual([
      ["2026-10", "October 2026", 1],
      ["2026-09", "September 2026", 2],
    ]);
    expect(monthNet(months[1]!)).toBe(110);
    expect(monthGross(months[1]!)).toBe(220);
  });
});

describe("groupState / groupMethod", () => {
  const g = (over: Partial<ReportRow>) => groupByPeriod([row(over)])[0]!;
  it("state follows the period, defaulting to OPEN", () => {
    expect(groupState(g({ periodState: "LOCKED" }))).toBe("LOCKED");
    expect(groupState(g({ periodState: "PAID" }))).toBe("PAID");
    expect(groupState(g({ periodState: "OPEN" }))).toBe("OPEN");
  });
  it("method is null until paid, then BANK unless CASH was recorded", () => {
    expect(groupMethod(g({ periodState: "LOCKED" }))).toBeNull();
    expect(groupMethod(g({ periodState: "PAID", periodPaymentMethod: null }))).toBe("BANK");
    expect(groupMethod(g({ periodState: "PAID", periodPaymentMethod: "CASH" }))).toBe("CASH");
  });
  it("salaried paystub groups bucket as PAID by BANK, or CASH when the period says so", () => {
    expect(groupState(g({ periodState: "OPEN", isSalariedPaystub: true }))).toBe("PAID");
    expect(groupMethod(g({ periodState: "OPEN", isSalariedPaystub: true }))).toBe("BANK");
    expect(groupMethod(g({ periodState: "OPEN", isSalariedPaystub: true, periodPaymentMethod: "CASH" }))).toBe("CASH");
  });
});

describe("matchesFilters", () => {
  const g = (over: Partial<ReportRow>) => groupByPeriod([row(over)])[0]!;
  it("filters by status and by method", () => {
    const paidCash = g({ periodState: "PAID", periodPaymentMethod: "CASH" });
    expect(matchesFilters(paidCash, "", "PAID", "CASH")).toBe(true);
    expect(matchesFilters(paidCash, "", "LOCKED", "all")).toBe(false);
    expect(matchesFilters(paidCash, "", "all", "BANK")).toBe(false);
    expect(matchesFilters(g({ periodState: "LOCKED" }), "", "all", "BANK")).toBe(false);
  });
  it("search matches the formatted range or the schedule name, case-insensitively", () => {
    const weekly = g({});
    expect(matchesFilters(weekly, "sep 28", "all", "all")).toBe(true);
    expect(matchesFilters(weekly, "WEEK", "all", "all")).toBe(true);
    expect(matchesFilters(weekly, "monthly", "all", "all")).toBe(false);
    expect(matchesFilters(g({ scheduleName: null }), "salaried", "all", "all")).toBe(true);
  });
});

describe("pageNumbers", () => {
  it("lists every page up to seven", () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("uses gaps beyond seven: first five, neighbours of the current page, the last", () => {
    expect(pageNumbers(1, 14)).toEqual([1, 2, 3, 4, 5, "gap", 14]);
    expect(pageNumbers(9, 14)).toEqual([1, 2, 3, 4, 5, "gap", 8, 9, 10, "gap", 14]);
    expect(pageNumbers(14, 14)).toEqual([1, 2, 3, 4, 5, "gap", 13, 14]);
  });
  it("page size is 25", () => {
    expect(PAGE_SIZE).toBe(25);
  });
});

describe("formatDate", () => {
  it("formats a date in the viewer's zone and dashes a missing one", () => {
    expect(formatDate(new Date(2026, 9, 5, 12))).toBe("Oct 05, 2026");
    expect(formatDate(null)).toBe("—");
  });
});
