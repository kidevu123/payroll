import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  readLatestHallMonitorReport,
  runWeeklyHallMonitorJob,
} from "@/lib/hall-monitor/run-weekly-audit";
import { requireAdmin } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

const SEVERITY_STYLES = {
  ok: "text-success-800 bg-success-50 border-success-200",
  warn: "text-amber-900 bg-amber-50 border-amber-200",
  fail: "text-danger-800 bg-danger-50 border-danger-200",
} as const;

export default async function HallMonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const stored = await readLatestHallMonitorReport();
  const report =
    params.run === "1"
      ? await runWeeklyHallMonitorJob()
      : (stored?.report ?? null);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-brand" />
            Hall monitor
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Weekly outside verification: punch integrity, roster coverage, pay
            math drift, and NGTeco sync health. Runs automatically Monday 6:00
            AM ET; you can also run on demand.
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href="/hall-monitor?run=1">Run now</Link>
        </Button>
      </div>

      {!report ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-muted">
            No report yet. Click Run now or wait for the Monday scheduled job.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-base">
                Week {report.weekStart} – {report.weekEnd}
              </CardTitle>
              <CardDescription>
                Generated {new Date(report.generatedAt).toLocaleString("en-US", {
                  timeZone: report.timezone,
                })}{" "}
                ({report.timezone})
                {stored?.path ? ` · saved to ${stored.path}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 py-3 flex gap-4 text-sm">
              <span className="text-success-800">
                {report.summary.ok} ok
              </span>
              <span className="text-amber-900">
                {report.summary.warn} warn
              </span>
              <span className="text-danger-800">
                {report.summary.fail} fail
              </span>
            </CardContent>
          </Card>

          <ul className="space-y-2">
            {report.findings.map((f) => (
              <li
                key={f.id}
                className={`rounded-card border px-3 py-2 text-sm ${SEVERITY_STYLES[f.severity]}`}
              >
                <div className="font-medium capitalize">
                  {f.severity} · {f.category.replace(/_/g, " ")}
                </div>
                <p className="mt-0.5">{f.message}</p>
                {f.detail && (
                  <pre className="mt-2 text-[10px] opacity-80 overflow-x-auto">
                    {JSON.stringify(f.detail, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-xs text-text-muted">
        Also use the{" "}
        <Link href="/calendar" className="underline">
          calendar pending rail
        </Link>{" "}
        for day-to-day missed-punch approvals. Hall monitor is the weekly
        reconciliation pass before you lock payroll.
      </p>
    </div>
  );
}
