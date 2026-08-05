// Reports right rail: Report mix donut, Net pay trend, YTD summary, and a
// Generate-report CTA. Token-based dark surfaces; reuses the dashboard's
// glowing trend chart for the net-pay line.

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import { SpendTrendChart } from "@/components/dashboard/charts/lazy";
import { ReportMixDonut } from "./report-mix-donut-lazy";
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

      <RailCard title="Summary (YTD)">
        <div className="divide-y divide-border/60">
          <SummaryRow label="Gross pay">
            <MoneyDisplay cents={overview.ytd.totalGrossCents} monospace={false} />
          </SummaryRow>
          <SummaryRow label="Net pay" accent="#34d399">
            <MoneyDisplay cents={overview.ytd.totalNetCents} monospace={false} />
          </SummaryRow>
          <SummaryRow label="Deductions">
            <MoneyDisplay
              cents={Math.max(
                0,
                overview.ytd.totalGrossCents - overview.ytd.totalNetCents,
              )}
              monospace={false}
            />
          </SummaryRow>
          <SummaryRow label="Employees paid">{overview.ytd.employeesPaid}</SummaryRow>
          <SummaryRow label="Pay runs">{overview.ytd.totalReports}</SummaryRow>
        </div>
        <Link
          href="/dashboard"
          className="mt-3 flex items-center justify-between rounded-input px-1 py-1.5 text-[13px] font-semibold hover:underline"
          style={{ color: "#34d399" }}
        >
          View detailed analytics
          <span aria-hidden>→</span>
        </Link>
      </RailCard>

      <Link
        href="/api/reports/csv?type=periods"
        className="flex w-full items-center justify-center gap-2 rounded-card px-4 py-3 text-sm font-semibold"
        style={{ color: "#0b0b12", background: "linear-gradient(135deg, #34d399, #059669)", boxShadow: "0 10px 24px -12px rgba(5,150,105,0.7)" }}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Generate custom report
      </Link>
    </div>
  );
}
