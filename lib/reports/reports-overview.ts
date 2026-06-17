// Server-side aggregation for the Reports overview header + right rail.
// Pure shaping over data the page already fetches (listReports + getYtd) — no
// new queries, no faked numbers. Money stays integer cents.

import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import type { YtdRow } from "@/lib/reports/ytd";

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

/** Net for a report row: rounded run pay + per-period temp labor (counted
 *  once per period, matching the page's existing YTD-paid logic). */
function netCents(r: ReportRow, seenPeriodTemp: Set<string>): number {
  let v = r.amountCents;
  if (!seenPeriodTemp.has(r.periodId)) {
    seenPeriodTemp.add(r.periodId);
    v += r.tempLaborCents;
  }
  return v;
}

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
  const monthly = new Array(12).fill(0) as number[];
  const seenTemp = new Set<string>();
  let totalPaidYtd = 0;
  for (const r of reports) {
    if (r.startDate.slice(0, 4) !== String(year)) continue;
    const mi = Number(r.startDate.slice(5, 7)) - 1;
    const n = netCents(r, seenTemp);
    if (mi >= 0 && mi < 12) monthly[mi] = (monthly[mi] ?? 0) + n;
    if (r.periodState === "PAID") totalPaidYtd += n;
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
