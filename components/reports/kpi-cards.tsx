// Four KPI cards across the top of Payroll Reports (owner mock, Sep 2026):
// tinted icon plate, label, figure, and one line of context. The context
// lines are real data or nothing — delta vs the prior year through the
// same date, awaiting-payment count, active/inactive split.

import { ArrowDownRight, ArrowUpRight, CalendarDays, DollarSign, Users, Wallet } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import type { YearSummary } from "@/lib/reports/year-summary";

function Delta({ pct, priorYear }: { pct: number | null; priorYear: number }) {
  if (pct === null) {
    return <span className="text-caption text-text-subtle">No {priorYear} data to compare</span>;
  }
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-caption font-medium ${up ? "text-success-700" : "text-danger-700"}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? "+" : ""}
      {pct}% vs {priorYear}
    </span>
  );
}

function Card({
  label,
  tone,
  icon: Icon,
  value,
  context,
}: {
  label: string;
  tone: "brand" | "info";
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  context: React.ReactNode;
}) {
  const plate = tone === "brand" ? "bg-brand-50 text-brand-700" : "bg-info-50 text-info-700";
  return (
    <div className="flex items-start gap-4 rounded-card border border-border/70 bg-surface px-5 py-4 shadow-card">
      <span aria-hidden className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-input ${plate}`}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <div className="text-sm text-text-muted">{label}</div>
        <div className="mt-0.5 truncate text-metric tabular-nums tracking-tight text-text">{value}</div>
        <div className="mt-1">{context}</div>
      </div>
    </div>
  );
}

export function ReportsKpiCards({
  summary,
  employeesActive,
  employeesInactive,
}: {
  summary: YearSummary;
  employeesActive: number;
  employeesInactive: number;
}) {
  const c = summary.comparison;
  const paid = employeesActive + employeesInactive;
  const awaiting = summary.byMethod.slices.find((s) => s.key === "UNPAID")?.periods ?? 0;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card label="Gross wages" tone="brand" icon={DollarSign}
        value={<MoneyDisplay cents={c.grossCents} monospace={false} />}
        context={<Delta pct={c.grossDeltaPct} priorYear={c.priorYear} />} />
      <Card label="Take-home pay" tone="info" icon={Wallet}
        value={<MoneyDisplay cents={c.netCents} monospace={false} />}
        context={<Delta pct={c.netDeltaPct} priorYear={c.priorYear} />} />
      <Card label="Pay runs" tone="brand" icon={CalendarDays}
        value={summary.periodCount}
        context={<span className="text-caption text-text-subtle tabular-nums">{awaiting} awaiting payment</span>} />
      <Card label="Employees paid" tone="info" icon={Users}
        value={paid}
        context={<span className="text-caption text-text-subtle tabular-nums">{employeesActive} active · {employeesInactive} inactive</span>} />
    </div>
  );
}
