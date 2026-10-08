// The reports ledger's data model: runs grouped into pay periods, periods into
// months, the period/month money totals, and the filter, sort and paging
// rules. Pure functions over rows already in memory; moved out of
// app/(admin)/reports/reports-table.tsx so they can be tested.
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import { formatPeriodRange as formatRange } from "@/lib/payroll/format-period";
import { periodNetCents } from "@/lib/reports/period-net";

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return `${MONTH_SHORT[dt.getMonth()]} ${String(dt.getDate()).padStart(2, "0")}, ${dt.getFullYear()}`;
}

/** "May 2026" header for the month-cohort card. */
export function monthLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return `${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function monthKey(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type GroupedReport = {
  periodId: string;
  periodStart: string;
  periodEnd: string;
  scheduleName: string | null;
  tempLaborCents: number;
  docNetPayCents: number;
  replacedRunNetCents: number;
  /** Sum over the period's runs; null when no run carries the figure. */
  employeesPaid: number | null;
  hoursWorked: number | null;
  runs: ReportRow[];
};

export type MonthGroup = {
  key: string;
  label: string;
  periods: GroupedReport[];
};

/** Group runs by periodId while preserving the newest-first ordering of
 *  the input list. Each group keeps the metadata of its first run (which
 *  represents the period). */
export function groupByPeriod(reports: ReportRow[]): GroupedReport[] {
  const groups: GroupedReport[] = [];
  const indexById = new Map<string, number>();
  for (const r of reports) {
    let idx = indexById.get(r.periodId);
    if (idx === undefined) {
      idx = groups.length;
      indexById.set(r.periodId, idx);
      groups.push({
        periodId: r.periodId,
        periodStart: r.startDate,
        periodEnd: r.endDate,
        scheduleName: r.scheduleName,
        tempLaborCents: r.tempLaborCents,
        docNetPayCents: r.docNetPayCents,
        replacedRunNetCents: r.replacedRunNetCents,
        employeesPaid: null,
        hoursWorked: null,
        runs: [],
      });
    }
    const group = groups[idx];
    if (group) {
      group.runs.push(r);
      if (r.employeesPaid !== undefined) {
        group.employeesPaid = (group.employeesPaid ?? 0) + r.employeesPaid;
      }
      if (r.hoursWorked !== undefined) {
        group.hoursWorked = (group.hoursWorked ?? 0) + r.hoursWorked;
      }
    }
  }
  return groups;
}

/** Roll periods up into month cohorts, preserving newest-first order. */
export function groupByMonth(periods: GroupedReport[]): MonthGroup[] {
  const months: MonthGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const p of periods) {
    const mk = monthKey(p.periodStart);
    let idx = indexByKey.get(mk);
    if (idx === undefined) {
      idx = months.length;
      indexByKey.set(mk, idx);
      months.push({ key: mk, label: monthLabel(p.periodStart), periods: [] });
    }
    const month = months[idx];
    if (month) month.periods.push(p);
  }
  return months;
}

/** Period NET = the actual take-home paid.
 *
 *  For salaried/W2 employees the run computes pay UNTAXED (≈ gross), but the
 *  uploaded W2 paystub carries the real net. So we SWAP: subtract the run net
 *  of employees who have a paystub (replacedRunNetCents) and add the paystub
 *  net (docNetPayCents). Hourly employees (no paystub) keep their run net, so a
 *  mixed period stays correct. No double-count, and net never exceeds gross. */
export function periodNet(g: GroupedReport): number {
  let total = 0;
  for (const r of g.runs) total += r.amountCents;
  return periodNetCents({
    runTotalCents: total,
    replacedRunNetCents: g.replacedRunNetCents,
    docNetPayCents: g.docNetPayCents,
    tempLaborCents: g.tempLaborCents,
  });
}

/** Period GROSS = sum of run gross + temp labor (temp counted once). */
export function periodGross(g: GroupedReport): number {
  let total = 0;
  for (const r of g.runs) total += r.grossPayCents;
  return total + g.tempLaborCents;
}

/** Month NET subtotal across its periods, from already-fetched rows. */
export function monthNet(m: MonthGroup): number {
  let total = 0;
  for (const p of m.periods) total += periodNet(p);
  return total;
}

/** Month GROSS subtotal across its periods. */
export function monthGross(m: MonthGroup): number {
  let total = 0;
  for (const p of m.periods) total += periodGross(p);
  return total;
}

// ── Filter bar state ─────────────────────────────────────────────────────
// Everything below the schedule select is client-side over rows already in
// memory — instant, no server round trip. Schedule navigates (?schedule=)
// because the server merges salaried paystubs per tab.

export type StatusFilter = "all" | "PAID" | "LOCKED" | "OPEN";
export type MethodFilter = "all" | "BANK" | "CASH";
export type SortKey = "newest" | "oldest" | "net-desc" | "net-asc";

export function groupState(g: GroupedReport): "OPEN" | "LOCKED" | "PAID" {
  const s = g.runs[0]?.periodState;
  if (s === "LOCKED" || s === "PAID") return s;
  // Salaried paystub groups have no run state — an uploaded paystub is a
  // paid document, so they bucket under PAID.
  if (g.runs.some((r) => r.isSalariedPaystub)) return "PAID";
  return "OPEN";
}

export function groupMethod(g: GroupedReport): MethodFilter | null {
  // Salaried W2 paystubs are paid out via bank transfer (owner directive),
  // unless their period explicitly recorded a cash-drawer payment.
  if (g.runs.some((r) => r.isSalariedPaystub)) {
    return g.runs[0]?.periodPaymentMethod === "CASH" ? "CASH" : "BANK";
  }
  if (groupState(g) !== "PAID") return null;
  return g.runs[0]?.periodPaymentMethod === "CASH" ? "CASH" : "BANK";
}

export function matchesFilters(
  g: GroupedReport,
  q: string,
  status: StatusFilter,
  method: MethodFilter,
): boolean {
  if (status !== "all" && groupState(g) !== status) return false;
  if (method !== "all" && groupMethod(g) !== method) return false;
  if (q) {
    const hay = `${formatRange(g.periodStart, g.periodEnd)} ${g.scheduleName ?? "salaried"}`.toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

export const PAGE_SIZE = 25;

/** Page numbers with an ellipsis gap, like the mock: 1 2 3 4 5 … 14. */
export function pageNumbers(page: number, count: number): Array<number | "gap"> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set<number>([1, 2, 3, 4, 5, count, page - 1, page, page + 1]);
  const nums = [...set].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  for (let i = 0; i < nums.length; i += 1) {
    const n = nums[i]!;
    if (i > 0 && n - nums[i - 1]! > 1) out.push("gap");
    out.push(n);
  }
  return out;
}
