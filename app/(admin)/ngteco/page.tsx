import Link from "next/link";
import { Workflow } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  // Pull periods in parallel for display.
  const periods = await Promise.all(
    runs.map((r) => getPeriodById(r.periodId)),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">NGTeco runs</h1>
        <p className="text-sm text-[--text-muted]">
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
        <div className="space-y-2">
          {runs.map((r, i) => {
            const p = periods[i];
            return (
              <Card key={r.id}>
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-4 border-b-0">
                  <div>
                    <CardTitle className="text-base font-mono">
                      {r.id.slice(0, 8)}…
                    </CardTitle>
                  </div>
                  <StatusPill
                    status={(r.state === "INGEST_FAILED" ? "INGEST_FAILED" : r.state) as never}
                  />
                </CardHeader>
                <CardContent className="flex items-center justify-between p-4 pt-2 text-xs text-[--text-muted]">
                  <div>
                    Period: {p?.startDate} – {p?.endDate} · Duration {durationOf(r)} ·
                    {" "}Started {r.ingestStartedAt?.toISOString().slice(0, 19)}Z
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/ngteco/${r.id}`}>Detail</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
