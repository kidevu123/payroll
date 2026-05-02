import Link from "next/link";
import { Workflow } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/domain/status-pill";
import { listRuns } from "@/lib/db/queries/payroll-runs";
import { getPeriodById } from "@/lib/db/queries/pay-periods";

function durationOf(run: { ingestStartedAt: Date | null; ingestCompletedAt: Date | null }): string {
  if (!run.ingestStartedAt) return "—";
  const end = run.ingestCompletedAt?.getTime() ?? Date.now();
  const ms = end - run.ingestStartedAt.getTime();
  if (ms < 0) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export default async function NgtecoRunsPage() {
  const runs = await listRuns(30);
  const periods = await Promise.all(
    runs.map((r) => getPeriodById(r.periodId)),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">NGTeco runs</h1>
        <p className="text-sm text-text-muted">
          Last {runs.length} import attempts, newest first.
        </p>
      </div>
      {runs.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No imports yet"
          description="Configure credentials in Settings, then run an import."
          action={
            <Button asChild>
              <Link href="/settings/ngteco">Configure NGTeco</Link>
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="min-w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border bg-surface-2/60">
              <tr>
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium">Period</th>
                <th className="px-3 py-2 font-medium text-right">Duration</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 font-medium text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.map((r, i) => {
                const p = periods[i];
                return (
                  <tr key={r.id} className="hover:bg-surface-2/40">
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.id.slice(0, 8)}…
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill
                        status={(r.state === "INGEST_FAILED" ? "INGEST_FAILED" : r.state) as never}
                      />
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {p ? `${p.startDate} – ${p.endDate}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-text-muted">
                      {durationOf(r)}
                    </td>
                    <td className="px-3 py-2 text-text-muted text-xs">
                      {r.ingestStartedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/ngteco/${r.id}`}>Detail</Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
