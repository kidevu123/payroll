"use client";

import * as React from "react";
import { Combine, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mergeDuplicatePunchesAction } from "../actions";

export function DedupPunchesButton({
  periodId,
  initialClusterCount,
}: {
  periodId: string;
  initialClusterCount: number;
}) {
  const [clusters, setClusters] = React.useState(initialClusterCount);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<
    { voided: number; clusters: number } | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

  if (clusters === 0 && !result) return null;

  return (
    <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="flex-1">
          <p className="font-medium text-amber-900">
            {clusters} duplicate punch cluster
            {clusters === 1 ? "" : "s"} detected in this period.
          </p>
          <p className="text-xs text-amber-800">
            Same employee, same in/out minute. Most likely caused by the
            realtime poll and CSV import both inserting the same physical
            shift. Merging keeps the row with the longest closed duration
            and voids the rest with an audit trail. Reversible — voids
            don&apos;t delete data.
          </p>
        </div>
      </div>
      {result && (
        <div className="flex items-start gap-2 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Voided {result.voided} duplicate
            {result.voided === 1 ? "" : "s"} across {result.clusters} cluster
            {result.clusters === 1 ? "" : "s"}. Affected payslips will
            recompute on next publish.
          </span>
        </div>
      )}
      {error && (
        <p className="text-xs text-red-700">{error}</p>
      )}
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const r = await mergeDuplicatePunchesAction(periodId);
          setPending(false);
          if ("ok" in r) {
            setResult({ voided: r.voided, clusters: r.clusters });
            setClusters(0);
          } else {
            setError(r.error ?? "Unknown error");
          }
        }}
      >
        <Combine className="h-3.5 w-3.5" />
        {pending ? "Merging…" : `Merge duplicates`}
      </Button>
    </div>
  );
}
