"use client";

import * as React from "react";
import { Combine, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mergeDuplicatePunchesAction } from "../actions";
import type { DuplicatePunchDetail } from "@/lib/punches/duplicate-details";

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function DedupPunchesButton({
  periodId,
  initialDetails,
}: {
  periodId: string;
  initialDetails: DuplicatePunchDetail[];
}) {
  const [details, setDetails] = React.useState(initialDetails);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<
    { voided: number; clusters: number } | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const clusters = details.length;

  if (clusters === 0 && !result) return null;

  return (
    <div className="rounded-card border border-warning-200 bg-warning-50 p-3 text-sm space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" />
        <div className="flex-1">
          <p className="font-medium text-warning-900">
            {clusters} duplicate punch cluster
            {clusters === 1 ? "" : "s"} detected in this period.
          </p>
          <p className="text-xs text-warning-800">
            Same employee, same in/out minute. Most likely caused by the
            realtime poll and CSV import both inserting the same physical
            shift. Merging keeps the row with the longest closed duration
            and voids the rest with an audit trail. Reversible — voids
            don&apos;t delete data.
          </p>
        </div>
      </div>
      {details.length > 0 ? (
        <div className="space-y-2">
          {details.map((cluster) => (
            <details
              key={`${cluster.employeeId}-${cluster.keepPunchId}`}
              className="rounded-input border border-warn-300 bg-surface-2 px-3 py-2"
            >
              <summary className="cursor-pointer text-xs font-medium text-warning-900">
                {cluster.employeeName} · {cluster.localDate} ·{" "}
                {cluster.localTimeRange} · keep {shortId(cluster.keepPunchId)}, void{" "}
                {cluster.voidPunchIds.map(shortId).join(", ")}
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[540px] text-left text-xs">
                  <thead className="text-warning-900/80">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Action</th>
                      <th className="py-1 pr-3 font-medium">Punch ID</th>
                      <th className="py-1 pr-3 font-medium">Source</th>
                      <th className="py-1 pr-3 font-medium">Time</th>
                      <th className="py-1 pr-3 text-right font-medium">Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cluster.rows.map((row) => (
                      <tr key={row.id} className="border-t border-warning-100">
                        <td className="py-1.5 pr-3 font-medium">
                          {row.willKeep ? "Keep" : "Void"}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{shortId(row.id)}</td>
                        <td className="py-1.5 pr-3">{row.source}</td>
                        <td className="py-1.5 pr-3">{row.localTimeRange}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {row.durationHours}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      ) : null}
      {result && (
        <div className="flex items-start gap-2 text-xs text-success-800">
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
        <p className="text-xs text-danger-700">{error}</p>
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
            setDetails([]);
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
