"use client";

import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney } from "@/lib/utils";
import { CHART } from "../theme";
import type { TrendPoint } from "@/lib/payroll/dashboard-metrics";

type Props = {
  data: TrendPoint[];
};

type TooltipPayload = { payload: TrendPoint };

function TrendTooltip({
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
      className="rounded-md px-3 py-2 text-xs shadow-xl"
      style={{
        background: CHART.tooltipBg,
        border: `1px solid ${CHART.tooltipBorder}`,
        color: "#f4f4f8",
      }}
    >
      <div className="mb-0.5" style={{ color: "#a1a1b5" }}>
        {point.month}
      </div>
      <div className="text-sm font-semibold tabular-nums">
        {formatMoney(point.cents)}
      </div>
    </div>
  );
}

/** Highlighted, glowing dot on the final data point only. */
function LastDot(props: {
  cx?: number | undefined;
  cy?: number | undefined;
  index?: number | undefined;
  dataLength: number;
}) {
  const { cx, cy, index, dataLength } = props;
  if (cx === undefined || cy === undefined) return null;
  if (index !== dataLength - 1) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={8} fill={CHART.violetBright} fillOpacity={0.18} />
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={CHART.violetBright}
        stroke="#0b0b12"
        strokeWidth={2}
      />
    </g>
  );
}

export function SpendTrendChart({ data }: Props) {
  if (data.length < 2) {
    return (
      <div
        className="flex h-56 items-center justify-center rounded-lg text-sm"
        style={{ color: "#6e6e85", border: `1px dashed ${CHART.grid}` }}
      >
        Not enough monthly history to chart yet
      </div>
    );
  }

  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 12, right: 12, bottom: 4, left: 4 }}
        >
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART.violet} stopOpacity={0.32} />
              <stop offset="100%" stopColor={CHART.violet} stopOpacity={0} />
            </linearGradient>
            <filter id="trendGlow" x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <XAxis
            dataKey="month"
            tickLine={false}
            axisLine={false}
            tick={{ fill: CHART.axis, fontSize: 11 }}
            dy={6}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tick={{ fill: CHART.axis, fontSize: 10 }}
            domain={[0, (max: number) => max * 1.15]}
            tickFormatter={(v: number) => {
              const d = v / 100;
              if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(1)}M`;
              if (d >= 1_000) return `$${Math.round(d / 1_000)}K`;
              return `$${Math.round(d)}`;
            }}
          />
          <Tooltip
            content={<TrendTooltip />}
            cursor={{ stroke: CHART.violetBright, strokeOpacity: 0.2 }}
          />
          <Area
            type="monotone"
            dataKey="cents"
            stroke="none"
            fill="url(#trendFill)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="cents"
            stroke={CHART.violetBright}
            strokeWidth={2.5}
            filter="url(#trendGlow)"
            dot={(p) => (
              <LastDot
                key={`dot-${p.index}`}
                cx={p.cx}
                cy={p.cy}
                index={p.index}
                dataLength={data.length}
              />
            )}
            activeDot={{
              r: 5,
              fill: CHART.violetBright,
              stroke: "#0b0b12",
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
