// Year view of the payroll ledger, computed from report rows (pure, tested).
// Feeds the Payroll Reports header: KPI cards with a same-date comparison
// against the prior year, the monthly gross/net bars, the pay-method donut,
// and the per-schedule / per-method tabs.

import { periodNetCents } from "./period-net";

export type YearRowInput = {
  periodId: string;
  /** ISO date; the period is attributed to the year/month it ends in. */
  endDate: string;
  scheduleName: string | null;
  grossPayCents: number;
  amountCents: number;
  replacedRunNetCents: number;
  docNetPayCents: number;
  tempLaborCents: number;
  periodState: "OPEN" | "LOCKED" | "PAID";
  periodPaymentMethod: "BANK" | "CASH" | null;
};

export type MonthBar = { month: string; grossCents: number; netCents: number };
export type MethodSlice = {
  key: "BANK" | "CASH" | "UNPAID";
  label: string;
  periods: number;
  netCents: number;
  pct: number;
};
export type ScheduleLine = {
  name: string;
  periods: number;
  grossCents: number;
  netCents: number;
};
export type Comparison = {
  grossCents: number;
  netCents: number;
  /** null when the prior year has nothing to compare against. */
  grossDeltaPct: number | null;
  netDeltaPct: number | null;
  priorYear: number;
};

export type YearSummary = {
  year: number;
  periodCount: number;
  months: MonthBar[];
  byMethod: { total: number; slices: MethodSlice[] };
  bySchedule: ScheduleLine[];
  comparison: Comparison;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}
function monthIndexOf(iso: string): number {
  return Number(iso.slice(5, 7)) - 1;
}

/** Collapse runs to one entry per period (gross summed, net via the W2 swap). */
function collapsePeriods(rows: YearRowInput[]) {
  const byPeriod = new Map<
    string,
    { endDate: string; scheduleName: string | null; grossCents: number; netCents: number; state: YearRowInput["periodState"]; method: YearRowInput["periodPaymentMethod"] }
  >();
  const runTotals = new Map<string, number>();
  for (const r of rows) {
    runTotals.set(r.periodId, (runTotals.get(r.periodId) ?? 0) + r.amountCents);
  }
  for (const r of rows) {
    const existing = byPeriod.get(r.periodId);
    if (existing) {
      existing.grossCents += r.grossPayCents;
      continue;
    }
    byPeriod.set(r.periodId, {
      endDate: r.endDate,
      scheduleName: r.scheduleName,
      grossCents: r.grossPayCents,
      netCents: periodNetCents({
        runTotalCents: runTotals.get(r.periodId) ?? 0,
        replacedRunNetCents: r.replacedRunNetCents,
        docNetPayCents: r.docNetPayCents,
        tempLaborCents: r.tempLaborCents,
      }),
      state: r.periodState,
      method: r.periodPaymentMethod,
    });
  }
  return [...byPeriod.values()];
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export function computeYearSummary(
  rows: YearRowInput[],
  year: number,
  /** "Today" in the company's calendar, ISO date. Drives the same-date comparison. */
  todayIso: string,
): YearSummary {
  const periods = collapsePeriods(rows);
  const thisYear = periods.filter((p) => yearOf(p.endDate) === year);

  const months: MonthBar[] = MONTHS.map((month) => ({ month, grossCents: 0, netCents: 0 }));
  for (const p of thisYear) {
    const m = months[monthIndexOf(p.endDate)];
    if (!m) continue;
    m.grossCents += p.grossCents;
    m.netCents += p.netCents;
  }

  const methodAcc = { BANK: { periods: 0, netCents: 0 }, CASH: { periods: 0, netCents: 0 }, UNPAID: { periods: 0, netCents: 0 } };
  for (const p of thisYear) {
    const key = p.state === "PAID" ? (p.method === "CASH" ? "CASH" : "BANK") : "UNPAID";
    methodAcc[key].periods += 1;
    methodAcc[key].netCents += p.netCents;
  }
  const total = thisYear.length;
  const slices: MethodSlice[] = (
    [
      ["BANK", "Bank transfer"],
      ["CASH", "Cash drawer"],
      ["UNPAID", "Not yet paid"],
    ] as const
  )
    .map(([key, label]) => ({
      key,
      label,
      periods: methodAcc[key].periods,
      netCents: methodAcc[key].netCents,
      pct: pct(methodAcc[key].periods, total),
    }))
    .filter((s) => s.periods > 0);

  const schedAcc = new Map<string, ScheduleLine>();
  for (const p of thisYear) {
    const name = p.scheduleName ?? "No schedule";
    const line = schedAcc.get(name) ?? { name, periods: 0, grossCents: 0, netCents: 0 };
    line.periods += 1;
    line.grossCents += p.grossCents;
    line.netCents += p.netCents;
    schedAcc.set(name, line);
  }
  const bySchedule = [...schedAcc.values()].sort((a, b) => b.netCents - a.netCents);

  // Same-date comparison: this year through today vs prior year through
  // the same month/day. A partial year against a full prior year would
  // always read as a drop.
  const cutoff = todayIso.slice(4); // "-MM-DD"
  const sumThrough = (y: number) =>
    periods
      .filter((p) => yearOf(p.endDate) === y && p.endDate.slice(4) <= cutoff)
      .reduce(
        (acc, p) => ({ gross: acc.gross + p.grossCents, net: acc.net + p.netCents }),
        { gross: 0, net: 0 },
      );
  const cur = sumThrough(year);
  const prior = sumThrough(year - 1);
  const delta = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

  return {
    year,
    periodCount: total,
    months,
    byMethod: { total, slices },
    bySchedule,
    comparison: {
      grossCents: cur.gross,
      netCents: cur.net,
      grossDeltaPct: delta(cur.gross, prior.gross),
      netDeltaPct: delta(cur.net, prior.net),
      priorYear: year - 1,
    },
  };
}
