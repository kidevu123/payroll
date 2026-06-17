"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/utils";
import { CHART } from "../theme";
import type { SparkPoint } from "@/lib/payroll/dashboard-metrics";

type Props = {
  data: SparkPoint[];
  /** Unique id so multiple gradients/filters on one page don't collide. */
  gradientId: string;
};

type TooltipPayload = {
  payload: SparkPoint;
};

function SparkTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div
      className="rounded-md px-2.5 py-1.5 text-[11px] shadow-lg"
      style={{
        background: CHART.tooltipBg,
        border: `1px solid ${CHART.tooltipBorder}`,
        color: "#f4f4f8",
      }}
    >
      <div className="font-medium tabular-nums">{formatMoney(point.cents)}</div>
      <div style={{ color: "#a1a1b5" }}>{point.label}</div>
    </div>
  );
}

export function CadenceSparkline({ data, gradientId }: Props) {
  if (data.length < 2) {
    return (
      <div
        className="flex h-14 items-center justify-center rounded-md text-[11px]"
        style={{ color: "#6e6e85", border: `1px dashed ${CHART.grid}` }}
      >
        Not enough history yet
      </div>
    );
  }

  return (
    <div className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.violetBright} stopOpacity={0.45} />
              <stop offset="100%" stopColor={CHART.violet} stopOpacity={0} />
            </linearGradient>
            <filter id={`${gradientId}-glow`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            content={<SparkTooltip />}
            cursor={{ stroke: CHART.violetBright, strokeOpacity: 0.25 }}
          />
          <Area
            type="monotone"
            dataKey="cents"
            stroke={CHART.violetBright}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            filter={`url(#${gradientId}-glow)`}
            dot={false}
            activeDot={{
              r: 3,
              fill: CHART.violetBright,
              stroke: "#0b0b12",
              strokeWidth: 1.5,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
