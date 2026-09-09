// Secondary ledger tabs: per-employee year-to-date, per-schedule, and
// per-payment-method rollups. Plain aligned tables in the same card chrome
// as the pay-runs ledger.

import { MoneyDisplay } from "@/components/domain/money-display";
import { formatHours } from "@/lib/utils";
import type { YearSummary } from "@/lib/reports/year-summary";

export type EmployeeYtdLine = {
  employeeId: string;
  name: string;
  status: string;
  hours: number;
  grossCents: number;
  netCents: number;
};

const HEAD = "text-micro uppercase text-text-subtle";
const ROW = "border-t border-border/60";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-border/70 bg-surface shadow-card">
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function EmployeesYtdTable({ rows, year }: { rows: EmployeeYtdLine[]; year: number }) {
  if (rows.length === 0) {
    return <Shell><p className="p-10 text-center text-sm text-text-muted">No published payslips in {year}.</p></Shell>;
  }
  return (
    <Shell>
      <table className="w-full text-sm">
        <thead>
          <tr className={HEAD}>
            <th className="px-5 py-2.5 text-left font-medium">Employee</th>
            <th className="px-5 py-2.5 text-left font-medium">Status</th>
            <th className="px-5 py-2.5 text-right font-medium">Hours</th>
            <th className="px-5 py-2.5 text-right font-medium">Gross pay</th>
            <th className="px-5 py-2.5 text-right font-medium">Net pay</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className={`${ROW} hover:bg-surface-2/40`}>
              <td className="px-5 py-2.5 font-medium text-text">{r.name}</td>
              <td className="px-5 py-2.5 text-text-muted">{r.status === "ACTIVE" ? "Active" : r.status === "INACTIVE" ? "Inactive" : "Terminated"}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-text-muted">{formatHours(r.hours)}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-text-muted"><MoneyDisplay cents={r.grossCents} /></td>
              <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-text"><MoneyDisplay cents={r.netCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

export function SchedulesTable({ summary }: { summary: YearSummary }) {
  return (
    <Shell>
      <table className="w-full text-sm">
        <thead>
          <tr className={HEAD}>
            <th className="px-5 py-2.5 text-left font-medium">Schedule</th>
            <th className="px-5 py-2.5 text-right font-medium">Pay periods</th>
            <th className="px-5 py-2.5 text-right font-medium">Gross pay</th>
            <th className="px-5 py-2.5 text-right font-medium">Net pay</th>
          </tr>
        </thead>
        <tbody>
          {summary.bySchedule.map((s) => (
            <tr key={s.name} className={`${ROW} hover:bg-surface-2/40`}>
              <td className="px-5 py-2.5 font-medium text-text">{s.name}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-text-muted">{s.periods}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-text-muted"><MoneyDisplay cents={s.grossCents} /></td>
              <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-text"><MoneyDisplay cents={s.netCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

export function MethodsTable({ summary }: { summary: YearSummary }) {
  return (
    <Shell>
      <table className="w-full text-sm">
        <thead>
          <tr className={HEAD}>
            <th className="px-5 py-2.5 text-left font-medium">Paid via</th>
            <th className="px-5 py-2.5 text-right font-medium">Pay periods</th>
            <th className="px-5 py-2.5 text-right font-medium">Share</th>
            <th className="px-5 py-2.5 text-right font-medium">Net pay</th>
          </tr>
        </thead>
        <tbody>
          {summary.byMethod.slices.map((s) => (
            <tr key={s.key} className={`${ROW} hover:bg-surface-2/40`}>
              <td className="px-5 py-2.5 font-medium text-text">{s.label}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-text-muted">{s.periods}</td>
              <td className="px-5 py-2.5 text-right tabular-nums text-text-muted">{s.pct}%</td>
              <td className="px-5 py-2.5 text-right tabular-nums font-semibold text-text"><MoneyDisplay cents={s.netCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}
