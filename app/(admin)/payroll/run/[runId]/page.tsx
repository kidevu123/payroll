// /payroll/run/[runId] — state-driven review screen.
//
// Shows totals + per-employee breakdown identical to the Phase 1 period
// review, but layered with the state machine: action buttons depend on
// the run's current state. Approve enqueues the publish job.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/domain/status-pill";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { ExceptionBadge } from "@/components/domain/exception-badge";
import { getRun, listExceptions } from "@/lib/db/queries/payroll-runs";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import { listAlertsForPeriod } from "@/lib/db/queries/alerts";
import { listPayslipsForPeriod } from "@/lib/db/queries/payslips";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { db } from "@/lib/db";
import { taskPayLineItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
import { RunActions } from "./run-actions";

export default async function RunReviewPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();
  const period = await getPeriodById(run.periodId);
  if (!period) notFound();

  const [employees, punches, payRules, payPeriod, alerts, payslips, company, exceptions] = await Promise.all([
    listEmployees(),
    listPunches({ periodId: period.id }),
    getSetting("payRules"),
    getSetting("payPeriod"),
    listAlertsForPeriod(period.id),
    listPayslipsForPeriod(period.id),
    getSetting("company"),
    listExceptions(runId),
  ]);
  const tz = company.timezone ?? "America/New_York";

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
  const alertsByE = new Map<string, typeof alerts>();
  for (const a of alerts) {
    const list = alertsByE.get(a.employeeId) ?? [];
    list.push(a);
    alertsByE.set(a.employeeId, list);
  }
  const payslipByE = new Map(payslips.map((p) => [p.employeeId, p]));

  const rows = await Promise.all(
    employees.map(async (e) => {
      const ePunches = punchesByE.get(e.id) ?? [];
      const eTasks = tasksByE.get(e.id) ?? [];
      const eAlerts = alertsByE.get(e.id) ?? [];
      if (ePunches.length === 0 && eTasks.length === 0 && eAlerts.length === 0) return null;
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
      return {
        employee: e,
        result,
        alerts: eAlerts,
        payslip: payslipByE.get(e.id),
      };
    }),
  );
  const rendered = rows.filter((r): r is NonNullable<typeof r> => r !== null);

  const totals = rendered.reduce(
    (acc, r) => {
      acc.hours += r.result.totalHours;
      acc.gross += r.result.grossCents;
      acc.rounded += r.result.roundedCents;
      return acc;
    },
    { hours: 0, gross: 0, rounded: 0 },
  );

  const unresolvedAlerts = alerts.filter((a) => !a.resolvedAt).length;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/payroll">
            <ArrowLeft className="h-4 w-4" /> All periods
          </Link>
        </Button>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold font-mono">{run.id.slice(0, 8)}…</h1>
          <StatusPill status={run.state as never} />
        </div>
        <p className="text-sm text-text-muted">
          Period: {period.startDate} – {period.endDate} · {employees.length} employees ·{" "}
          {unresolvedAlerts} unresolved alert{unresolvedAlerts === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-employee summary</CardTitle>
        </CardHeader>
        <CardContent>
          {rendered.length === 0 ? (
            <p className="text-sm text-text-muted">No punches, tasks, or alerts on this run.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
                  <tr>
                    <th className="py-2.5 pr-3 font-medium">Employee</th>
                    <th className="py-2.5 px-3 font-medium text-right">Hours</th>
                    <th className="py-2.5 px-3 font-medium text-right">Gross</th>
                    <th className="py-2.5 px-3 font-medium text-right">Rounded</th>
                    <th className="py-2.5 px-3 font-medium">Alerts</th>
                    <th className="py-2.5 px-3 font-medium">Payslip</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rendered.map(({ employee, result, alerts: eAlerts, payslip }) => (
                    <tr key={employee.id} className="hover:bg-surface-2/40 transition-colors">
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/employees/${employee.id}`}
                          className="font-medium hover:text-brand-700 hover:underline underline-offset-2"
                        >
                          {employee.displayName}
                        </Link>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        <HoursDisplay
                          hours={result.totalHours}
                          decimals={payRules.hoursDecimalPlaces}
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        <MoneyDisplay cents={result.grossCents} />
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        <MoneyDisplay cents={result.roundedCents} />
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {eAlerts
                            .filter((a) => !a.resolvedAt)
                            .map((a) => (
                              <ExceptionBadge key={a.id} issue={a.issue} />
                            ))}
                          {eAlerts.filter((a) => !a.resolvedAt).length === 0 && (
                            <span className="text-xs text-text-subtle">—</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-xs">
                        {payslip ? (
                          <span className="inline-flex items-center gap-1 text-success-700 font-medium">
                            <CircleCheck className="h-3.5 w-3.5" />
                            {payslip.acknowledgedAt ? "ack" : "published"}
                          </span>
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm font-medium">
                  <tr className="border-t-2 border-border">
                    <td className="py-2 pr-3">Totals</td>
                    <td className="py-2 px-3 text-right">
                      <HoursDisplay
                        hours={totals.hours}
                        decimals={payRules.hoursDecimalPlaces}
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <MoneyDisplay cents={totals.gross} />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <MoneyDisplay cents={totals.rounded} />
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {exceptions.length > 0 && (
        <Card>
          <details>
            <CardHeader>
              <summary className="cursor-pointer list-none">
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  Skipped rows ({exceptions.length})
                  <span className="ml-auto text-xs text-text-muted font-normal">
                    Click to expand
                  </span>
                </CardTitle>
              </summary>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 px-3 font-medium">Ref</th>
                      <th className="py-2 px-3 font-medium">Reason / details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {exceptions.slice(0, 50).map((e) => {
                    const raw = (e.rawData ?? {}) as Record<string, unknown>;
                    const reason =
                      typeof raw.reason === "string"
                        ? raw.reason
                        : typeof raw.error === "string"
                          ? raw.error
                          : "";
                    const rawRow = raw.raw as Record<string, string> | undefined;
                    const summary = rawRow
                      ? [rawRow["date"], rawRow["clock_in"], rawRow["clock_out"], rawRow["first_name"], rawRow["last_name"]]
                          .filter(Boolean)
                          .join(" · ")
                      : "";
                    return (
                      <tr key={e.id} className="hover:bg-surface-2/30">
                        <td className="py-1.5 pr-3 font-mono text-xs">{e.type}</td>
                        <td className="py-1.5 px-3 font-mono text-xs">
                          {e.ngtecoEmployeeRef ?? "—"}
                        </td>
                        <td className="py-1.5 px-3 text-xs">
                          <div>{reason}</div>
                          {summary && (
                            <div className="text-text-subtle truncate">{summary}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
                {exceptions.length > 50 && (
                  <p className="mt-2 text-xs text-text-muted">
                    Showing first 50 of {exceptions.length}. Resolve in /ngteco/{run.id}.
                  </p>
                )}
              </div>
            </CardContent>
          </details>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Punches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {rendered.length === 0 ? (
            <p className="text-sm text-text-muted">
              No punches landed on this run yet.
            </p>
          ) : (
            rendered.map(({ employee }) => {
              const ePunches = punchesByE.get(employee.id) ?? [];
              const byDay = new Map<string, typeof ePunches>();
              for (const p of ePunches) {
                if (p.voidedAt) continue;
                const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
                  p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn),
                );
                const list = byDay.get(day) ?? [];
                list.push(p);
                byDay.set(day, list);
              }
              const days = Array.from(byDay.entries()).sort((a, b) =>
                a[0].localeCompare(b[0]),
              );
              return (
                <div key={employee.id} className="space-y-2">
                  <div className="font-semibold text-sm border-b border-border pb-1">
                    {employee.displayName}
                  </div>
                  {days.length === 0 ? (
                    <p className="text-xs text-text-muted">No punches.</p>
                  ) : (
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle">
                        <tr>
                          <th className="py-1 pr-3 font-medium">Day</th>
                          <th className="py-1 px-3 font-medium">In</th>
                          <th className="py-1 px-3 font-medium">Out</th>
                          <th className="py-1 px-3 font-medium text-right">Hours</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {days.flatMap(([day, ps]) =>
                          ps
                            .sort((a, b) => {
                              const ai = a.clockIn instanceof Date ? a.clockIn : new Date(a.clockIn);
                              const bi = b.clockIn instanceof Date ? b.clockIn : new Date(b.clockIn);
                              return ai.getTime() - bi.getTime();
                            })
                            .map((p, i) => {
                              const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
                              const outT = p.clockOut
                                ? p.clockOut instanceof Date
                                  ? p.clockOut
                                  : new Date(p.clockOut)
                                : null;
                              const hours = outT
                                ? (outT.getTime() - inT.getTime()) / 3_600_000
                                : null;
                              return (
                                <tr key={p.id} className="hover:bg-surface-2/30">
                                  <td className="py-1 pr-3 text-text-muted">
                                    {i === 0
                                      ? new Intl.DateTimeFormat("en-US", {
                                          weekday: "short",
                                          month: "short",
                                          day: "numeric",
                                          timeZone: tz,
                                        }).format(new Date(`${day}T12:00:00Z`))
                                      : ""}
                                  </td>
                                  <td className="py-1 px-3 font-mono">
                                    {new Intl.DateTimeFormat("en-US", {
                                      hour: "numeric",
                                      minute: "2-digit",
                                      timeZone: tz,
                                    }).format(inT)}
                                  </td>
                                  <td className="py-1 px-3 font-mono">
                                    {outT
                                      ? new Intl.DateTimeFormat("en-US", {
                                          hour: "numeric",
                                          minute: "2-digit",
                                          timeZone: tz,
                                        }).format(outT)
                                      : "—"}
                                  </td>
                                  <td className="py-1 px-3 text-right font-mono tabular-nums">
                                    {hours !== null ? hours.toFixed(2) : "—"}
                                  </td>
                                </tr>
                              );
                            }),
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <RunActions
        runId={run.id}
        state={run.state}
        unresolvedAlerts={unresolvedAlerts}
        totals={{
          employees: rendered.length,
          gross: totals.gross,
          rounded: totals.rounded,
        }}
      />

      <p className="text-xs text-text-muted">
        Rounding: {payRules.rounding}. Period length: {payPeriod.lengthDays} days.
      </p>
    </div>
  );
}
