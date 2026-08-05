"use client";

// Report-mix donut for the Reports right rail. Counts of reports by cadence,
// with a center total and a legend. Recharts PieChart; colors match the dark
// theme's accents.

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { ReportsOverview } from "@/lib/reports/reports-overview";

// Mirrors the cadence colors in components/domain/schedule-tabs.tsx
// (weekly blue, semi cyan, monthly amber, salaried emerald), brightened
// for the dark reports canvas.
const SLICE_COLOR: Record<string, string> = {
  WEEKLY: "#60a5fa",
  SEMI: "#22d3ee",
  MONTHLY: "#fbbf24",
  SALARIED: "#34d399",
};

export function ReportMixDonut({ mix }: { mix: ReportsOverview["mix"] }) {
  if (mix.total === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-text-subtle">
        No reports yet
      </div>
    );
  }
  const data = mix.slices.map((s) => ({ ...s, fill: SLICE_COLOR[s.key] ?? "#71717a" }));
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-36 w-36 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius="68%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold leading-none tabular-nums text-text">
            {mix.total}
          </span>
          <span className="mt-0.5 text-[10px] uppercase tracking-wide text-text-subtle">
            Total
          </span>
        </div>
      </div>
      <ul className="flex-1 space-y-1.5">
        {data.map((d) => (
          <li key={d.key} className="flex items-center gap-2 text-[12px]">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: d.fill }}
            />
            <span className="flex-1 truncate text-text-muted">{d.label}</span>
            <span className="font-semibold tabular-nums text-text">{d.count}</span>
            <span className="w-12 text-right tabular-nums text-text-subtle">
              {d.pct.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
