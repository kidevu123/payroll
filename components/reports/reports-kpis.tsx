// Reports overview KPI row — four stat cards matching the owner's reference:
// Gross pay, Net pay, Deductions, Employees paid, each with a tinted icon
// plate. Token-based surfaces (inherits the admin .dark context). Real data
// only — deductions is simply gross minus net across the same rows.

import { DollarSign, Wallet, Percent, Users } from "lucide-react";
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
    <div className="flex items-center gap-3.5 rounded-card border border-border/70 bg-surface p-4 shadow-card">
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-input"
        style={{
          color: accent,
          background: `color-mix(in srgb, ${accent} 14%, transparent)`,
          boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 22%, transparent)`,
        }}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-subtle">
          {label}
        </div>
        <div className="mt-0.5 truncate text-2xl font-bold leading-tight tracking-tight tabular-nums text-text">
          {children}
        </div>
        <div className="text-[11px] text-text-subtle">{sub}</div>
      </div>
    </div>
  );
}

export function ReportsKpis({ ytd }: { ytd: ReportsOverview["ytd"] }) {
  const deductions = Math.max(0, ytd.totalGrossCents - ytd.totalNetCents);
  return (
    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Gross pay" icon={DollarSign} accent="#a78bfa" sub="Year to date">
        <MoneyDisplay cents={ytd.totalGrossCents} monospace={false} />
      </KpiCard>
      <KpiCard label="Net pay" icon={Wallet} accent="#34d399" sub="Year to date">
        <MoneyDisplay cents={ytd.totalNetCents} monospace={false} />
      </KpiCard>
      <KpiCard label="Deductions" icon={Percent} accent="#fbbf24" sub="Gross minus net, YTD">
        <MoneyDisplay cents={deductions} monospace={false} />
      </KpiCard>
      <KpiCard label="Employees paid" icon={Users} accent="#60a5fa" sub="Year to date">
        {ytd.employeesPaid}
      </KpiCard>
    </div>
  );
}
