// Reports overview KPI row — Gross pay, Net pay, Deductions, Employees paid.
//
// The icon plates are MONOCHROME on purpose. They used to carry four different
// accents (emerald, emerald, a hardcoded #fbbf24, a hardcoded #60a5fa) that
// encoded nothing — decorative color competing with the figures, and the two
// hardcoded values were dark-theme brights that washed out on the light
// surface. Color in this app means something (status, direction); a stat tile's
// icon is just a signpost, so it stays quiet and the number does the talking.

import { DollarSign, Wallet, Percent, Users } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import type { ReportsOverview } from "@/lib/reports/reports-overview";

function KpiCard({
  label,
  icon: Icon,
  children,
  sub,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3.5 rounded-card border border-border/70 bg-surface p-4 shadow-card">
      <span
        aria-hidden
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-input bg-surface-2 text-text-muted"
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <div className="text-micro uppercase text-text-subtle">
          {label}
        </div>
        <div className="mt-0.5 truncate text-metric tabular-nums text-text">
          {children}
        </div>
        <div className="text-caption text-text-subtle">{sub}</div>
      </div>
    </div>
  );
}

export function ReportsKpis({ ytd }: { ytd: ReportsOverview["ytd"] }) {
  const deductions = Math.max(0, ytd.totalGrossCents - ytd.totalNetCents);
  return (
    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard label="Gross pay" icon={DollarSign} sub="Year to date">
        <MoneyDisplay cents={ytd.totalGrossCents} monospace={false} />
      </KpiCard>
      <KpiCard label="Net pay" icon={Wallet} sub="Year to date">
        <MoneyDisplay cents={ytd.totalNetCents} monospace={false} />
      </KpiCard>
      <KpiCard label="Deductions" icon={Percent} sub="Gross minus net, YTD">
        <MoneyDisplay cents={deductions} monospace={false} />
      </KpiCard>
      <KpiCard label="Employees paid" icon={Users} sub="Year to date">
        {ytd.employeesPaid}
      </KpiCard>
    </div>
  );
}
