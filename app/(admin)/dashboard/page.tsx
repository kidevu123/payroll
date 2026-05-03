// Admin dashboard — Phase 3. PayrollRunCard fills the visual center and
// drives the Sunday-night close. Secondary cards: pending requests + last
// NGTeco import.

import Link from "next/link";
import {
  CalendarDays,
  MessageSquareWarning,
  Workflow,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/domain/money-display";
import { StatusPill } from "@/components/domain/status-pill";
import { PayrollRunCard } from "@/components/domain/payroll-run-card";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import {
  getCurrentPeriod,
  getMostRecentPeriod,
} from "@/lib/db/queries/pay-periods";
import {
  getCurrentRun,
  listRuns,
} from "@/lib/db/queries/payroll-runs";
import { listAlertsForPeriod } from "@/lib/db/queries/alerts";
import {
  listPendingMissedPunchRequests,
  listPendingTimeOffRequests,
} from "@/lib/db/queries/requests";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { db } from "@/lib/db";
import { taskPayLineItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function todayInTz(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export default async function DashboardPage() {
  const company = await getSetting("company");
  const today = todayInTz(company.timezone);
  // Read-only — never auto-creates a period. Owner directive: only the
  // CSV upload should kick off period creation.
  const period = (await getCurrentPeriod(today)) ?? (await getMostRecentPeriod());
  const run = await getCurrentRun();
  const [pendingMissed, pendingTimeOff] = await Promise.all([
    listPendingMissedPunchRequests(),
    listPendingTimeOffRequests(),
  ]);
  const pendingTotal = pendingMissed.length + pendingTimeOff.length;

  let stats:
    | {
        hours: number;
        gross: number;
        rounded: number;
        employeeCount: number;
        unresolvedAlerts: number;
      }
    | undefined;
  let cardState:
    | "NO_RUN"
    | "SCHEDULED"
    | "INGESTING"
    | "INGEST_FAILED"
    | "AWAITING_EMPLOYEE_FIXES"
    | "AWAITING_ADMIN_REVIEW"
    | "APPROVED"
    | "PUBLISHED"
    | "FAILED"
    | "CANCELLED" = "NO_RUN";

  if (run) cardState = run.state;

  if (period && run) {
    const [employees, punches, payRules, alerts] = await Promise.all([
      listEmployees({ status: "ACTIVE" }),
      listPunches({ periodId: period.id }),
      getSetting("payRules"),
      listAlertsForPeriod(period.id, { unresolvedOnly: true }),
    ]);
    const tasks = await db
      .select()
      .from(taskPayLineItems)
      .where(eq(taskPayLineItems.periodId, period.id));
    const punchesByE = new Map<string, typeof punches>();
    for (const p of punches) {
      const list = punchesByE.get(p.employeeId) ?? [];
      list.push(p);
      punchesByE.set(p.employeeId, list);
    }
    const tasksByE = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const list = tasksByE.get(t.employeeId) ?? [];
      list.push(t);
      tasksByE.set(t.employeeId, list);
    }

    let totals = { hours: 0, gross: 0, rounded: 0 };
    let activeWithWork = 0;
    for (const e of employees) {
      const ePunches = punchesByE.get(e.id) ?? [];
      const eTasks = tasksByE.get(e.id) ?? [];
      if (ePunches.length === 0 && eTasks.length === 0) continue;
      const rates = await listRates(e.id);
      const result = computePay({
        punches: ePunches,
        rateAt: (p) => {
          const day = (p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn))
            .toISOString()
            .slice(0, 10);
          for (const r of rates) if (r.effectiveFrom <= day) return r.hourlyRateCents;
          return e.hourlyRateCents ?? 0;
        },
        taskPay: eTasks.map((t) => ({ amountCents: t.amountCents })),
        rules: {
          rounding: payRules.rounding,
          hoursDecimalPlaces: payRules.hoursDecimalPlaces,
          ...(payRules.overtime.enabled
            ? {
                overtime: {
                  thresholdHours: payRules.overtime.thresholdHours,
                  multiplier: payRules.overtime.multiplier,
                },
              }
            : {}),
        },
      });
      totals.hours += result.totalHours;
      totals.gross += result.grossCents;
      totals.rounded += result.roundedCents;
      activeWithWork++;
    }
    stats = {
      ...totals,
      employeeCount: activeWithWork,
      unresolvedAlerts: alerts.length,
    };
  }

  // Enrich the recent-runs strip with period dates + schedule name +
  // amount so the dashboard speaks human, not UUID. Owner: "what does
  // 2c5f63cf mean????"
  const rawRecent = await listRuns(5);
  const recentRunIds = rawRecent.map((r) => r.id);
  const periodIds = Array.from(new Set(rawRecent.map((r) => r.periodId)));
  const scheduleIds = Array.from(
    new Set(rawRecent.map((r) => r.payScheduleId).filter((s): s is string => Boolean(s))),
  );
  const { payPeriods: periodsTable, paySchedules: schedulesTable } = await import("@/lib/db/schema");
  const { inArray } = await import("drizzle-orm");
  const [periodRows, scheduleRows] = await Promise.all([
    periodIds.length
      ? db.select().from(periodsTable).where(inArray(periodsTable.id, periodIds))
      : [],
    scheduleIds.length
      ? db.select().from(schedulesTable).where(inArray(schedulesTable.id, scheduleIds))
      : [],
  ]);
  const periodById = new Map(periodRows.map((p) => [p.id, p]));
  const scheduleById = new Map(scheduleRows.map((s) => [s.id, s]));
  const recentRuns = rawRecent.map((r) => ({
    ...r,
    period: periodById.get(r.periodId) ?? null,
    schedule: r.payScheduleId ? scheduleById.get(r.payScheduleId) ?? null : null,
  }));
  void recentRunIds;

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-text-muted">
            One place, one source of truth for the current payroll run.
          </p>
        </div>
      </header>

      <PayrollRunCard
        state={cardState}
        {...(period
          ? { period: { startDate: period.startDate, endDate: period.endDate } }
          : {})}
        {...(run?.id ? { runId: run.id } : {})}
        {...(stats ? { stats } : {})}
        {...(run?.employeeFixDeadline
          ? {
              fixDeadline: run.employeeFixDeadline.toISOString().slice(0, 16).replace("T", " "),
            }
          : {})}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pending requests</CardTitle>
            <CardDescription>
              {pendingTotal === 0
                ? "Nothing awaits your review."
                : `${pendingMissed.length} missed-punch · ${pendingTimeOff.length} time-off`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingTotal === 0 ? (
              <EmptyState
                icon={MessageSquareWarning}
                title="All clear"
                description="No employee submissions waiting on a decision."
                action={
                  <Button asChild variant="secondary">
                    <Link href="/requests">Open requests page</Link>
                  </Button>
                }
              />
            ) : (
              <div className="space-y-2">
                {pendingMissed.slice(0, 3).map((r) => (
                  <Link
                    key={r.id}
                    href={`/requests`}
                    className="block rounded-card border border-border bg-surface-2 p-3 hover:bg-surface-3 shadow-sm"
                  >
                    <div className="text-sm font-medium">Missed punch · {r.date}</div>
                    <div className="text-xs text-text-muted truncate">{r.reason}</div>
                  </Link>
                ))}
                {pendingTimeOff.slice(0, 3).map((r) => (
                  <Link
                    key={r.id}
                    href={`/requests`}
                    className="block rounded-card border border-border bg-surface-2 p-3 hover:bg-surface-3 shadow-sm"
                  >
                    <div className="text-sm font-medium">
                      Time off · {r.startDate} – {r.endDate} ({r.type.toLowerCase()})
                    </div>
                    {r.reason && (
                      <div className="text-xs text-text-muted truncate">{r.reason}</div>
                    )}
                  </Link>
                ))}
                {pendingTotal > 6 && (
                  <Button asChild variant="ghost" size="sm" className="mt-2">
                    <Link href="/requests">View all {pendingTotal}</Link>
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No runs yet"
                description="The first run kicks off on the configured cron."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {recentRuns.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={r.period ? `/payroll/${r.period.id}` : `/payroll/run/${r.id}`}
                      className="flex items-center justify-between gap-3 rounded-input border border-border px-3 py-2 hover:bg-surface-2"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {r.period
                            ? `${r.period.startDate} – ${r.period.endDate}`
                            : `run ${r.id.slice(0, 8)}`}
                        </div>
                        <div className="text-xs text-text-muted truncate">
                          {r.schedule?.name ?? "unassigned"}
                          {r.totalAmountCents !== null && (
                            <>
                              {" · "}
                              <MoneyDisplay
                                cents={r.totalAmountCents}
                                monospace={false}
                              />
                            </>
                          )}
                        </div>
                      </div>
                      <StatusPill status={r.state as never} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last NGTeco import</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRuns[0] ? (
            <div className="text-sm flex items-center justify-between">
              <span>
                {recentRuns[0].ingestStartedAt
                  ? recentRuns[0].ingestStartedAt.toISOString().slice(0, 16).replace("T", " ")
                  : "not yet started"}
              </span>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/ngteco/${recentRuns[0].id}`}>Detail</Link>
              </Button>
            </div>
          ) : (
            <EmptyState
              icon={Workflow}
              title="No imports yet"
              description="Configure the connection in Settings → NGTeco, then run a test import."
              action={
                <Button asChild variant="secondary">
                  <Link href="/settings/ngteco">Configure NGTeco</Link>
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
