// Server-side aggregation for the Reports overview header + right rail.
// Pure shaping over data the page already fetches (listReports + getYtd) — no
// new queries, no faked numbers. Money stays integer cents.

import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import type { YtdRow } from "@/lib/reports/ytd";
import { periodNetCents } from "@/lib/reports/period-net";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type CadenceSlice = {
  key: "WEEKLY" | "SEMI" | "MONTHLY" | "SALARIED";
  label: string;
  count: number;
  pct: number; // 0–100
};

export type NetTrendPoint = { month: string; cents: number };

export type ReportsOverview = {
  kpis: {
    totalPaidYtdCents: number;
    totalReports: number;
    draftCount: number;
    employeesPaid: number;
    avgGrossPerEmployeeCents: number | null;
    totalGrossYtdCents: number;
  };
  mix: { total: number; slices: CadenceSlice[] };
  netTrend: NetTrendPoint[];
  ytd: {
    totalGrossCents: number;
    totalNetCents: number;
    totalReports: number;
    employeesPaid: number;
  };
};

function cadenceOf(scheduleName: string | null): CadenceSlice["key"] {
  const n = (scheduleName ?? "").toLowerCase();
  if (n.includes("semi") || n.includes("twice") || n.includes("bi-month")) return "SEMI";
  if (n.includes("week")) return "WEEKLY";
  if (n.includes("month")) return "MONTHLY";
  return "SALARIED";
}

const CADENCE_LABEL: Record<CadenceSlice["key"], string> = {
  WEEKLY: "Weekly",
  SEMI: "Semi-monthly",
  MONTHLY: "Monthly",
  SALARIED: "Salaried",
};


export function computeReportsOverview(
  reports: ReportRow[],
  ytdRows: YtdRow[],
  year: number,
): ReportsOverview {
  // ── Report mix by cadence ────────────────────────────────────────────────
  const counts: Record<CadenceSlice["key"], number> = {
    WEEKLY: 0,
    SEMI: 0,
    MONTHLY: 0,
    SALARIED: 0,
  };
  for (const r of reports) counts[cadenceOf(r.scheduleName)] += 1;
  const total = reports.length;
  const slices: CadenceSlice[] = (Object.keys(counts) as CadenceSlice["key"][])
    .map((key) => ({
      key,
      label: CADENCE_LABEL[key],
      count: counts[key],
      pct: total > 0 ? (counts[key] / total) * 100 : 0,
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);

  // ── Net pay trend (monthly, current year, by period start) ───────────────
  // Aggregate to one net PER PERIOD using the canonical periodNetCents (which
  // applies the salaried/W2 take-home swap), then bucket each period into its
  // start-month / YTD-paid. Previously this summed raw run amounts per row and
  // never applied the swap, so the headline net / trend / YTD overstated net
  // for any period that paid salaried/W2 employees.
  const byPeriod = new Map<
    string,
    {
      runTotalCents: number;
      replacedRunNetCents: number;
      docNetPayCents: number;
      tempLaborCents: number;
      startDate: string;
      periodState: ReportRow["periodState"];
    }
  >();
  for (const r of reports) {
    const g = byPeriod.get(r.periodId);
    if (g) {
      g.runTotalCents += r.amountCents;
    } else {
      byPeriod.set(r.periodId, {
        runTotalCents: r.amountCents,
        replacedRunNetCents: r.replacedRunNetCents,
        docNetPayCents: r.docNetPayCents,
        tempLaborCents: r.tempLaborCents,
        startDate: r.startDate,
        periodState: r.periodState,
      });
    }
  }
  const monthly = new Array(12).fill(0) as number[];
  let totalPaidYtd = 0;
  for (const g of byPeriod.values()) {
    if (g.startDate.slice(0, 4) !== String(year)) continue;
    const n = periodNetCents(g);
    const mi = Number(g.startDate.slice(5, 7)) - 1;
    if (mi >= 0 && mi < 12) monthly[mi] = (monthly[mi] ?? 0) + n;
    if (g.periodState === "PAID") totalPaidYtd += n;
  }
  const lastMonthWithData = monthly.reduce((acc, v, i) => (v > 0 ? i : acc), 0);
  const netTrend: NetTrendPoint[] = [];
  for (let i = 0; i <= lastMonthWithData; i++) {
    netTrend.push({ month: MONTHS[i] ?? "", cents: monthly[i] ?? 0 });
  }

  // ── YTD per-employee totals (from persisted payslips) ────────────────────
  const totalGross = ytdRows.reduce((s, r) => s + r.grossCents, 0);
  const totalNet = ytdRows.reduce((s, r) => s + r.roundedCents, 0);
  const employeesPaid = ytdRows.length;
  const avgGross = employeesPaid > 0 ? Math.round(totalGross / employeesPaid) : null;

  const draftCount = reports.filter(
    (r) => r.state !== "PUBLISHED" && r.periodState !== "PAID",
  ).length;

  return {
    kpis: {
      totalPaidYtdCents: totalPaidYtd,
      totalReports: total,
      draftCount,
      employeesPaid,
      avgGrossPerEmployeeCents: avgGross,
      totalGrossYtdCents: totalGross,
    },
    mix: { total, slices },
    netTrend,
    ytd: {
      totalGrossCents: totalGross,
      totalNetCents: totalNet,
      totalReports: total,
      employeesPaid,
    },
  };
}
