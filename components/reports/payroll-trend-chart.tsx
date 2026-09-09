"use client";

// Monthly gross vs take-home bars for the selected year.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/utils";
import { CHART } from "@/components/dashboard/theme";
import type { MonthBar } from "@/lib/reports/year-summary";

function money(v: number): string {
  const d = v / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
  if (d >= 1_000) return `$${Math.round(d / 1_000)}K`;
  return `$${Math.round(d)}`;
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: MonthBar }>; label?: string }) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-input border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 font-medium text-text">{label}</div>
      <div className="flex justify-between gap-4 text-text-muted"><span>Gross</span><span className="tabular-nums text-text">{formatMoney(p.grossCents)}</span></div>
      <div className="flex justify-between gap-4 text-text-muted"><span>Take-home</span><span className="tabular-nums text-text">{formatMoney(p.netCents)}</span></div>
    </div>
  );
}

export function PayrollTrendChart({ data }: { data: MonthBar[] }) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={3} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={CHART.grid} strokeDasharray="3 4" />
          <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 11 }} dy={6} />
          <YAxis tickLine={false} axisLine={false} width={44} tick={{ fill: CHART.axis, fontSize: 11 }} tickFormatter={money} />
          <Tooltip content={<TrendTooltip />} cursor={{ fill: "var(--color-surface-2)", opacity: 0.6 }} />
          <Bar dataKey="grossCents" name="Gross" fill={CHART.emerald} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="netCents" name="Take-home" fill={CHART.emeraldDim} fillOpacity={0.55} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
