"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { formatMoney } from "@/lib/utils";
import { CHART } from "../theme";
import type { SparkPoint } from "@/lib/payroll/dashboard-metrics";

type Props = {
  data: SparkPoint[];
  /** Unique id so multiple gradients/filters on one page don't collide. */
  gradientId: string;
  /** Height utility class for the chart box. Defaults to a compact height. */
  className?: string;
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
      className="rounded-md px-2.5 py-1.5 text-xs shadow-lg"
      style={{
        background: CHART.tooltipBg,
        border: `1px solid ${CHART.tooltipBorder}`,
        color: "var(--dash-text)",
      }}
    >
      <div className="font-medium tabular-nums">{formatMoney(point.cents)}</div>
      <div style={{ color: "var(--dash-text-muted)" }}>{point.label}</div>
    </div>
  );
}

export function CadenceSparkline({
  data,
  gradientId,
  className = "h-14",
}: Props) {
  if (data.length < 2) {
    // Graceful flat baseline instead of a hollow bordered box — keeps the
    // card looking finished when a cadence has no history yet.
    return (
      <div className={`relative w-full ${className}`} aria-hidden>
        <span
          className="absolute inset-x-0 bottom-1/2 h-px"
          style={{ background: "var(--dash-border)" }}
        />
      </div>
    );
  }

  return (
    <div className={`w-full ${className}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 6, right: 0, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={CHART.violetBright}
                stopOpacity={0.45}
              />
              <stop offset="100%" stopColor={CHART.violet} stopOpacity={0} />
            </linearGradient>
            <filter
              id={`${gradientId}-glow`}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
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
              stroke: "var(--dash-bg)",
              strokeWidth: 1.5,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
