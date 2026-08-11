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
import {
  formatFindingForDisplay,
  sortFindingsForDisplay,
} from "@/lib/hall-monitor/display";
import { listEmployees } from "@/lib/db/queries/employees";
import { requireAdmin } from "@/lib/auth-guards";

export const dynamic = "force-dynamic";

const SEVERITY_STYLES = {
  ok: "border-success-200 bg-success-50/80",
  warn: "border-warning-200 bg-warning-50/80",
  fail: "border-danger-200 bg-danger-50/80",
} as const;

const SEVERITY_BADGE = {
  ok: "bg-success-100 text-success-900",
  warn: "bg-warning-100 text-warning-900",
  fail: "bg-danger-100 text-danger-900",
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

  const employees = await listEmployees();
  const employeeNameById = new Map(
    employees.map((e) => [e.id, e.displayName]),
  );

  const needsAttention = report
    ? report.summary.fail + report.summary.warn
    : 0;

  const displayFindings = report
    ? sortFindingsForDisplay(
        report.findings.map((f) =>
          formatFindingForDisplay(f, {
            timezone: report.timezone,
            employeeNameById,
          }),
        ),
      )
    : [];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-title tracking-tight antialiased text-text flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-brand" />
            Weekly payroll checklist
          </h1>
          <p className="text-sm text-text-muted mt-1 leading-relaxed">
            A simple pass over time clock sync, missing punches, and pay
            before you lock the week. Red means fix first. Yellow means review
            when you can.
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link href="/hall-monitor?run=1">Run check again</Link>
        </Button>
      </div>

      {!report ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-muted">
            No checklist yet. Click Run check again, or wait for Monday
            morning (6:00 AM ET).
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="px-4 py-3">
              <CardTitle>
                Week of {report.weekStart} through {report.weekEnd}
              </CardTitle>
              <CardDescription>
                Last run:{" "}
                {new Date(report.generatedAt).toLocaleString("en-US", {
                  timeZone: report.timezone,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 py-3 text-sm">
              {needsAttention === 0 ? (
                <p className="text-success-800 font-medium">
                  Nothing urgent — you are clear to proceed with payroll when
                  you are ready.
                </p>
              ) : (
                <p className="text-text">
                  <span className="font-semibold text-danger-800">
                    {report.summary.fail > 0
                      ? `${report.summary.fail} fix before payroll`
                      : null}
                    {report.summary.fail > 0 && report.summary.warn > 0
                      ? ", "
                      : null}
                    {report.summary.warn > 0
                      ? `${report.summary.warn} review this week`
                      : null}
                  </span>
                  {report.summary.ok > 0
                    ? ` · ${report.summary.ok} check(s) passed`
                    : null}
                </p>
              )}
            </CardContent>
          </Card>

          <ul className="space-y-3">
            {displayFindings.map((d, i) => (
              <li
                key={`${d.title}-${i}`}
                className={`rounded-card border px-4 py-3 ${SEVERITY_STYLES[d.severity]}`}
              >
                <div
                  className={`flex items-start gap-2 ${d.href ? "justify-between" : ""}`}
                >
                  <span
                    className={`shrink-0 rounded-chip px-2 py-0.5 text-[11px] font-medium ${SEVERITY_BADGE[d.severity]}`}
                  >
                    {d.severityLabel}
                  </span>
                  {d.href ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={d.href}>{d.hrefLabel ?? "Open"}</Link>
                    </Button>
                  ) : null}
                </div>
                <h2 className="mt-2 text-base font-semibold text-text">
                  {d.title}
                </h2>
                <div className="mt-2 space-y-2 text-sm text-text">
                  <div>
                    <p className="text-micro uppercase text-text-muted">
                      What this means
                    </p>
                    <p className="mt-0.5 leading-relaxed">{d.meaning}</p>
                  </div>
                  <div>
                    <p className="text-micro uppercase text-text-muted">
                      What to do
                    </p>
                    <p className="mt-0.5 leading-relaxed font-medium">
                      {d.action}
                    </p>
                  </div>
                  {d.bullets.length > 0 ? (
                    <ul className="list-disc pl-5 space-y-0.5 text-text-muted">
                      {d.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-6 border-t border-border pt-4 text-sm text-text-muted leading-relaxed">
        Day to day, use{" "}
        <Link href="/calendar" className="underline font-medium text-text">
          Calendar → Pending
        </Link>{" "}
        to approve employee punch fixes. This page is your once-a-week
        big-picture check before payroll.
      </p>
    </div>
  );
}
