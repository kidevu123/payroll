// Reports right rail: Report mix donut, Net pay trend, YTD summary, and a
// Generate-report CTA. Token-based dark surfaces; reuses the dashboard's
// glowing trend chart for the net-pay line.

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import { SpendTrendChart } from "@/components/dashboard/charts/spend-trend-chart";
import { ReportMixDonut } from "./report-mix-donut";
import type { ReportsOverview } from "@/lib/reports/reports-overview";

function RailCard({
  title,
  children,
  headline,
}: {
  title: string;
  headline?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-card border border-border/70 bg-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {headline ?? null}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SummaryRow({
  label,
  children,
  accent,
}: {
  label: string;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span className="text-text-muted">{label}</span>
      <span className="font-semibold tabular-nums" style={accent ? { color: accent } : { color: "var(--color-text)" }}>
        {children}
      </span>
    </div>
  );
}

export function ReportsRail({ overview }: { overview: ReportsOverview }) {
  return (
    <div className="space-y-3">
      <RailCard title="Report mix (YTD)">
        <ReportMixDonut mix={overview.mix} />
      </RailCard>

      <RailCard
        title="Net pay trend (YTD)"
        headline={
          <span className="text-lg font-bold tabular-nums text-text">
            <MoneyDisplay cents={overview.ytd.totalNetCents} monospace={false} />
          </span>
        }
      >
        {overview.netTrend.length >= 2 ? (
          <div className="-mx-1">
            <SpendTrendChart data={overview.netTrend} />
          </div>
        ) : (
          <p className="py-6 text-center text-[12px] text-text-subtle">
            Not enough history to chart yet
          </p>
        )}
      </RailCard>

      <RailCard title="YTD summary">
        <div className="divide-y divide-border/60">
          <SummaryRow label="Total gross pay">
            <MoneyDisplay cents={overview.ytd.totalGrossCents} monospace={false} />
          </SummaryRow>
          <SummaryRow label="Total net pay" accent="#34d399">
            <MoneyDisplay cents={overview.ytd.totalNetCents} monospace={false} />
          </SummaryRow>
          <SummaryRow label="Total reports">{overview.ytd.totalReports}</SummaryRow>
          <SummaryRow label="Employees paid">{overview.ytd.employeesPaid}</SummaryRow>
        </div>
      </RailCard>

      <Link
        href="/api/reports/csv?type=periods"
        className="flex w-full items-center justify-center gap-2 rounded-card px-4 py-3 text-sm font-semibold"
        style={{ color: "#0b0b12", background: "linear-gradient(135deg, #a78bfa, #7c3aed)", boxShadow: "0 10px 24px -12px rgba(124,58,237,0.7)" }}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Generate custom report
      </Link>
    </div>
  );
}
