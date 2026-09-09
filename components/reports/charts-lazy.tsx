"use client";

// recharts stays out of the initial bundle; same pattern as
// components/dashboard/charts/lazy.tsx.

import dynamic from "next/dynamic";
import { ChartSkeleton } from "@/components/ui/skeleton";

export const PayrollTrendChart = dynamic(
  () => import("./payroll-trend-chart").then((m) => m.PayrollTrendChart),
  { ssr: false, loading: () => <ChartSkeleton className="h-48" /> },
);

export const PayMethodDonut = dynamic(
  () => import("./pay-method-donut").then((m) => m.PayMethodDonut),
  { ssr: false, loading: () => <ChartSkeleton className="h-40" /> },
);
