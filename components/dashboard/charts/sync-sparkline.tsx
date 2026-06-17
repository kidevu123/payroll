"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  YAxis,
} from "recharts";
import { CHART } from "../theme";
import type { SyncPoint } from "@/lib/payroll/dashboard-metrics";

type Props = {
  data: SyncPoint[];
};

export function SyncSparkline({ data }: Props) {
  if (data.length < 2) {
    return (
      <div
        className="flex h-10 items-center text-[11px]"
        style={{ color: "#6e6e85" }}
      >
        No poll history yet
      </div>
    );
  }

  return (
    <div className="h-7 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="syncFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.emerald} stopOpacity={0.4} />
              <stop offset="100%" stopColor={CHART.emerald} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={[0, "dataMax"]} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={CHART.emerald}
            strokeWidth={1.75}
            fill="url(#syncFill)"
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
