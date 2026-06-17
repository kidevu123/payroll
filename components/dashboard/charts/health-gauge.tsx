"use client";

import {
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
} from "recharts";
import { CHART } from "../theme";

type Props = {
  score: number; // 0–100
};

function scoreColor(score: number): string {
  if (score >= 75) return CHART.emerald;
  if (score >= 50) return CHART.violetBright;
  return "#fb7185";
}

export function HealthGauge({ score }: Props) {
  const color = scoreColor(score);
  const data = [{ name: "score", value: score, fill: color }];

  return (
    <div className="relative h-16 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={data}
          startAngle={220}
          endAngle={-40}
          innerRadius="72%"
          outerRadius="100%"
          barSize={10}
        >
          <defs>
            <filter id="gaugeGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <PolarAngleAxis
            type="number"
            domain={[0, 100]}
            angleAxisId={0}
            tick={false}
          />
          <RadialBar
            background={{ fill: "rgba(255,255,255,0.06)" }}
            dataKey="value"
            cornerRadius={6}
            angleAxisId={0}
            filter="url(#gaugeGlow)"
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-3xl font-bold tabular-nums leading-none"
          style={{ color }}
        >
          {score}
        </span>
        <span className="mt-1 text-[10px] font-medium uppercase tracking-wider" style={{ color: "#6e6e85" }}>
          / 100
        </span>
      </div>
    </div>
  );
}
