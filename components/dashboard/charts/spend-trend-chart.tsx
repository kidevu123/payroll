"use client";

import {
  Area,
  CartesianGrid,
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

/** "$227.7K" / "$1.24M" compact label for the pinned end point. */
function compactLabel(cents: number): string {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(1)}K`;
  return `$${Math.round(d)}`;
}

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

/** A dot at every point; the final point gets a glow + pinned value label. */
function TrendDot(props: {
  cx?: number | undefined;
  cy?: number | undefined;
  index?: number | undefined;
  value?: number | undefined;
  dataLength: number;
}) {
  const { cx, cy, index, value, dataLength } = props;
  if (cx === undefined || cy === undefined) return null;
  const isLast = index === dataLength - 1;
  if (!isLast) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={2.5}
        fill={CHART.violetBright}
        stroke="#0b0b12"
        strokeWidth={1}
      />
    );
  }
  const label = value !== undefined ? compactLabel(value) : "";
  const boxW = 52;
  const boxH = 22;
  const boxX = cx - boxW - 2; // pin to the left of the dot so it never clips
  // Clamp so a high end-value doesn't push the label off the top of a short
  // chart; drop it just below the dot if there isn't room above.
  const boxY = cy - boxH - 10 < 2 ? cy + 8 : cy - boxH - 10;
  return (
    <g>
      <circle cx={cx} cy={cy} r={9} fill={CHART.violetBright} fillOpacity={0.16} />
      <circle cx={cx} cy={cy} r={4} fill={CHART.violetBright} stroke="#0b0b12" strokeWidth={2} />
      <g transform={`translate(${boxX}, ${boxY})`}>
        <rect
          width={boxW}
          height={boxH}
          rx={6}
          fill={CHART.tooltipBg}
          stroke={CHART.tooltipBorder}
        />
        <text
          x={boxW / 2}
          y={boxH / 2 + 4}
          textAnchor="middle"
          fill="#f4f4f8"
          fontSize={11}
          fontWeight={600}
        >
          {label}
        </text>
      </g>
    </g>
  );
}

export function SpendTrendChart({ data }: Props) {
  if (data.length < 2) {
    return (
      <div
        className="flex h-24 flex-1 items-center justify-center rounded-lg text-sm"
        style={{ color: "#6e6e85", border: `1px dashed ${CHART.grid}` }}
      >
        Not enough monthly history to chart yet
      </div>
    );
  }

  return (
    <div className="h-24 w-full flex-1 sm:h-24">
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
          <CartesianGrid
            vertical={false}
            stroke={CHART.grid}
            strokeDasharray="4 5"
          />
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
              <TrendDot
                key={`dot-${p.index}`}
                cx={p.cx}
                cy={p.cy}
                index={p.index}
                value={p.value}
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
