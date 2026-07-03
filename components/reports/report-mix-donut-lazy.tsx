// Lazy wrapper for the report-mix donut so recharts stays out of the Reports
// page's initial client bundle. Client boundary; importable from the
// server-rendered reports-rail.
"use client";

import dynamic from "next/dynamic";
import { ChartSkeleton } from "@/components/ui/skeleton";

export const ReportMixDonut = dynamic(
  () => import("./report-mix-donut").then((m) => m.ReportMixDonut),
  { ssr: false, loading: () => <ChartSkeleton className="h-36 w-36" /> },
);
