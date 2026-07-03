// Reports overview KPI row — five dark stat cards above the period list.
// Token-based surfaces (inherits the admin .dark context). Real data only.

import { DollarSign, FileText, Users, TrendingUp, Wallet } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import type { ReportsOverview } from "@/lib/reports/reports-overview";

function KpiCard({
  label,
  icon: Icon,
  accent,
  children,
  sub,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  children: React.ReactNode;
  sub: string;
}) {
  return (
    <div className="rounded-card border border-border/70 bg-surface p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-subtle">
          {label}
        </span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2"
          style={{ color: accent }}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="text-2xl font-bold leading-none tracking-tight tabular-nums text-text">
        {children}
      </div>
      <div className="mt-1.5 text-[11px] text-text-subtle">{sub}</div>
    </div>
  );
}

export function ReportsKpis({ kpis }: { kpis: ReportsOverview["kpis"] }) {
  return (
    <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-5">
      <KpiCard label="Total paid (YTD)" icon={DollarSign} accent="#a78bfa" sub="This calendar year">
        <MoneyDisplay cents={kpis.totalPaidYtdCents} monospace={false} />
      </KpiCard>
      <KpiCard
        label="Total reports"
        icon={FileText}
        accent="#a78bfa"
        sub={kpis.draftCount > 0 ? `${kpis.draftCount} draft${kpis.draftCount === 1 ? "" : "s"}` : "All published"}
      >
        {kpis.totalReports}
      </KpiCard>
      <KpiCard label="Employees paid" icon={Users} accent="#34d399" sub="Year to date">
        {kpis.employeesPaid}
      </KpiCard>
      <KpiCard label="Avg gross pay" icon={TrendingUp} accent="#a78bfa" sub="Per employee, YTD">
        {kpis.avgGrossPerEmployeeCents !== null ? (
          <MoneyDisplay cents={kpis.avgGrossPerEmployeeCents} monospace={false} />
        ) : (
          "—"
        )}
      </KpiCard>
      <KpiCard label="Total gross (YTD)" icon={Wallet} accent="#34d399" sub="Before deductions">
        <MoneyDisplay cents={kpis.totalGrossYtdCents} monospace={false} />
      </KpiCard>
    </div>
  );
}
