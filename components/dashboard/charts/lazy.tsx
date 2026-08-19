// Code-split recharts. recharts is ~large and non-critical (below-the-fold,
// decorative trend/gauge visuals), so we keep it out of the initial client
// bundle of the dashboard and reports pages. These lazy wrappers load the
// chart chunk only after hydration (ssr:false), showing a same-height
// skeleton so the card body never shifts. This module is a client boundary
// so it can be imported from both client parents (insight-cards, cadence-card)
// and server parents (reports-rail).
"use client";

import dynamic from "next/dynamic";
import { ChartSkeleton } from "@/components/ui/skeleton";

export const SpendTrendChart = dynamic(
  () => import("./spend-trend-chart").then((m) => m.SpendTrendChart),
  { ssr: false, loading: () => <ChartSkeleton className="h-14" /> },
);

export const SyncSparkline = dynamic(
  () => import("./sync-sparkline").then((m) => m.SyncSparkline),
  { ssr: false, loading: () => <ChartSkeleton className="h-7" /> },
);

export const HealthGauge = dynamic(
  () => import("./health-gauge").then((m) => m.HealthGauge),
  { ssr: false, loading: () => <ChartSkeleton className="h-[4.5rem]" /> },
);

export const CadenceSparkline = dynamic(
  () => import("./cadence-sparkline").then((m) => m.CadenceSparkline),
  { ssr: false, loading: () => <ChartSkeleton className="h-14" /> },
);
