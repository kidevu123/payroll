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
import { PayrollRunCard } from "@/components/domain/payroll-run-card";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import {
  ensureNextPeriod,
  getCurrentPeriod,
  getMostRecentPeriod,
} from "@/lib/db/queries/pay-periods";
import {
  getCurrentRun,
  listRuns,
} from "@/lib/db/queries/payroll-runs";
import { listAlertsForPeriod } from "@/lib/db/queries/alerts";
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
  await ensureNextPeriod(today);

  const period = (await getCurrentPeriod(today)) ?? (await getMostRecentPeriod());
  const run = await getCurrentRun();

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

  const recentRuns = await listRuns(3);

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[--text-muted]">
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
            <CardDescription>Missed punches and time off awaiting your review.</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={MessageSquareWarning}
              title="Lands in Phase 5"
              description="The full request flow (employee submit, admin approve) ships when notifications go live."
              action={
                <Button asChild variant="secondary">
                  <Link href="/requests">Open</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Last 3 payroll runs.</CardDescription>
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
                      href={`/payroll/run/${r.id}`}
                      className="flex items-center justify-between rounded-[--radius-input] border border-[--border] px-3 py-2 hover:bg-[--surface-2]"
                    >
                      <span className="font-mono text-xs">{r.id.slice(0, 8)}…</span>
                      <span className="text-[--text-muted]">{r.state}</span>
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
          <CardDescription>Status of the most recent automated punch ingest.</CardDescription>
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
