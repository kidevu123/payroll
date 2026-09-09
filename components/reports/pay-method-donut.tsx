"use client";

// How this year's pay periods were settled: bank transfer, cash drawer,
// or not yet paid. Center figure is the period count.

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { DASH } from "@/components/dashboard/theme";
import type { MethodSlice } from "@/lib/reports/year-summary";

const COLOR: Record<MethodSlice["key"], string> = {
  BANK: DASH.emerald,
  CASH: DASH.blue,
  UNPAID: DASH.amber,
};

export function PayMethodDonut({ total, slices }: { total: number; slices: MethodSlice[] }) {
  if (total === 0) {
    return <p className="py-10 text-center text-sm text-text-subtle">No pay periods this year yet.</p>;
  }
  return (
    <div className="flex flex-col items-center gap-4 2xl:flex-row 2xl:gap-5">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="periods" nameKey="label" innerRadius={54} outerRadius={76} paddingAngle={2} stroke="none" isAnimationActive={false}>
              {slices.map((s) => (
                <Cell key={s.key} fill={COLOR[s.key]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-metric tabular-nums tracking-tight text-text">{total}</span>
          <span className="text-caption text-text-subtle">Pay runs</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLOR[s.key] }} />
            <span className="min-w-0 flex-1 truncate text-text-muted">{s.label}</span>
            <span className="tabular-nums text-text-subtle">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
