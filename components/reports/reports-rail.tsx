// Reports right rail: Report mix donut and Net pay trend.
//
// It used to also carry a "Summary (YTD)" card (the same four figures as
// the KPI tiles directly above the table) and a gradient "Generate custom
// report" CTA (the same CSV as Export -> Period totals). Both were
// duplicates, and the rail's hardcoded emerald text clashed with whatever
// brand color the owner had chosen. Chrome now rides the brand tokens;
// only the chart colors stay fixed because they encode data.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
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

export function ReportsRail({ overview }: { overview: ReportsOverview }) {
  return (
    <div className="space-y-3">
      <RailCard title="Report mix (YTD)">
        <ReportMixDonut mix={overview.mix} />
      </RailCard>

      <RailCard
        title="Net pay trend (YTD)"
        headline={
          <span className="text-sm font-semibold tabular-nums text-text">
            <MoneyDisplay cents={overview.ytd.totalNetCents} monospace={false} />
          </span>
        }
      >
        {overview.netTrend.length >= 2 ? (
          <div className="-mx-1">
            <SpendTrendChart data={overview.netTrend} compact />
          </div>
        ) : (
          <p className="py-6 text-center text-[12px] text-text-subtle">
            Not enough history to chart yet
          </p>
        )}
        <Link
          href="/dashboard"
          className="mt-3 flex items-center justify-between rounded-input px-1 py-1 text-[13px] font-medium text-brand-700 hover:underline"
        >
          View detailed analytics
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </RailCard>
    </div>
  );
}
