// Per-period admin report. v1.2 layout: two sections, one scroll.
//   • Top: employee totals (name | hours | gross | rounded | publish-pill)
//   • Bottom: punches chronologically per employee (in/out/hours per day)
// Reused for both legacy LEGACY_IMPORT runs and live cron-generated runs.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusPill } from "@/components/domain/status-pill";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { db } from "@/lib/db";
import { taskPayLineItems, payrollRuns, paySchedules } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { LockButtons } from "./lock-buttons";
import { PublishPortalButton } from "./publish-portal-button";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRange(startIso: string, endIso: string): string {
  const a = new Date(`${startIso}T12:00:00Z`);
  const b = new Date(`${endIso}T12:00:00Z`);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${MONTH_SHORT[a.getUTCMonth()]} ${String(a.getUTCDate()).padStart(2, "0")}${sameYear ? "" : `, ${a.getUTCFullYear()}`}`;
  const right = `${MONTH_SHORT[b.getUTCMonth()]} ${String(b.getUTCDate()).padStart(2, "0")}, ${b.getUTCFullYear()}`;
  return `${left} – ${right}`;
}

function formatHm(d: Date | null, tz: string): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(dt);
}

function formatDayLabel(dateIso: string, tz: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(d);
}

export default async function PeriodReviewPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const period = await getPeriodById(periodId);
  if (!period) notFound();

  const [allEmployees, punches, payRules, payPeriod, company, schedules] = await Promise.all([
    listEmployees(),
    listPunches({ periodId }),
    getSetting("payRules"),
    getSetting("payPeriod"),
    getSetting("company"),
    db.select().from(paySchedules),
  ]);
  const tz = company.timezone ?? "America/New_York";

  // Most recent run for this period (the one that drives the publish-pill).
  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.periodId, periodId))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);
  const runScheduleId = run?.payScheduleId ?? null;
  const runSchedule = runScheduleId
    ? schedules.find((s) => s.id === runScheduleId)
    : null;

  // Filter employees to those on the same schedule as the run, when set.
  // Legacy weekly runs include every non-Juan employee, SM runs include
  // only Juan — both fall out of this filter naturally.
  const employees = runScheduleId
    ? allEmployees.filter((e) => e.payScheduleId === runScheduleId)
    : allEmployees;

  const punchesByEmployee = new Map<string, typeof punches>();
  for (const p of punches) {
    if (runScheduleId) {
      const e = employees.find((x) => x.id === p.employeeId);
      if (!e) continue;
    }
    const list = punchesByEmployee.get(p.employeeId) ?? [];
    list.push(p);
    punchesByEmployee.set(p.employeeId, list);
  }

  const tasks = await db
    .select()
    .from(taskPayLineItems)
    .where(eq(taskPayLineItems.periodId, periodId));
  const tasksByEmployee = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = tasksByEmployee.get(t.employeeId) ?? [];
    list.push(t);
    tasksByEmployee.set(t.employeeId, list);
  }

  const rows = await Promise.all(
    employees.map(async (e) => {
      const ePunches = punchesByEmployee.get(e.id) ?? [];
      const eTasks = tasksByEmployee.get(e.id) ?? [];
      if (ePunches.length === 0 && eTasks.length === 0) return null;
      const rates = await listRates(e.id);
      const result = computePay({
        punches: ePunches,
        rateAt: (p) => {
          const day = new Intl.DateTimeFormat("en-CA", {
            timeZone: "UTC",
          }).format(p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn));
          for (const r of rates) {
            if (r.effectiveFrom <= day) return r.hourlyRateCents;
          }
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
      const incomplete = ePunches.filter((p) => !p.voidedAt && !p.clockOut).length;
      return { employee: e, result, incomplete, punches: ePunches };
    }),
  );
  const rendered = rows
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => a.employee.displayName.localeCompare(b.employee.displayName));

  const totals = rendered.reduce(
    (acc, r) => {
      acc.hours += r.result.totalHours;
      acc.gross += r.result.grossCents;
      acc.rounded += r.result.roundedCents;
      return acc;
    },
    { hours: 0, gross: 0, rounded: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/reports">
              <ArrowLeft className="h-4 w-4" /> All reports
            </Link>
          </Button>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {formatRange(period.startDate, period.endDate)}
            </h1>
            <StatusPill status={period.state} />
            {runSchedule && (
              <span className="rounded-input bg-surface-3 px-2 py-0.5 text-xs text-text-muted">
                {runSchedule.name}
              </span>
            )}
          </div>
          {run && (
            <p className="mt-1 text-sm text-text-muted">
              Created by{" "}
              <span className="font-medium text-text">
                {run.createdByName ?? "system"}
              </span>
              {run.postedAt
                ? ` · Posted ${run.postedAt.toISOString().slice(0, 10)}`
                : null}
              {" · "}
              <MoneyDisplay
                cents={run.totalAmountCents ?? totals.rounded}
                monospace={false}
              />
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {run?.pdfPath && (
            <Button asChild variant="secondary" size="sm">
              <Link
                href={`/api/reports/${run.id}/pdf`}
                target="_blank"
                rel="noopener"
              >
                <Download className="h-4 w-4" /> Download PDF
              </Link>
            </Button>
          )}
          {run && <PublishPortalButton run={run} />}
        </div>
      </div>

      {/* TOP HALF: Employee totals */}
      <Card>
        <CardHeader>
          <CardTitle>Employee totals</CardTitle>
        </CardHeader>
        <CardContent>
          {rendered.length === 0 ? (
            <p className="text-sm text-text-muted">
              No punches or task pay recorded for this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
                  <tr>
                    <th className="py-2.5 pr-3 font-medium">Employee</th>
                    <th className="py-2.5 px-3 font-medium text-right">Hours</th>
                    <th className="py-2.5 px-3 font-medium text-right">Gross</th>
                    <th className="py-2.5 px-3 font-medium text-right">Rounded</th>
                    <th className="py-2.5 px-3 font-medium text-right">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rendered.map(({ employee, result, incomplete }) => (
                    <tr key={employee.id} className="hover:bg-surface-2/40 transition-colors">
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/employees/${employee.id}`}
                          className="font-semibold hover:text-brand-700 hover:underline underline-offset-2"
                        >
                          {employee.displayName}
                        </Link>
                        <div className="text-xs text-text-muted">
                          {employee.payType === "FLAT_TASK"
                            ? `Per task · ${employee.hourlyRateCents !== null ? `$${(employee.hourlyRateCents / 100).toFixed(2)}` : "—"}`
                            : employee.hourlyRateCents !== null
                              ? `$${(employee.hourlyRateCents / 100).toFixed(2)}/hr`
                              : "—"}
                        </div>
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
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        <MoneyDisplay cents={result.roundedCents} />
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {incomplete > 0 ? (
                          <span className="text-warn-700">{incomplete} incomplete</span>
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
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      <HoursDisplay
                        hours={totals.hours}
                        decimals={payRules.hoursDecimalPlaces}
                      />
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      <MoneyDisplay cents={totals.gross} />
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      <MoneyDisplay cents={totals.rounded} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* BOTTOM HALF: Punches per employee, chronologically */}
      <Card>
        <CardHeader>
          <CardTitle>Punches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {rendered.map(({ employee, punches }) => {
            // Group punches by day (in employee's display tz).
            const byDay = new Map<string, typeof punches>();
            for (const p of punches) {
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
                <div className="flex items-center gap-2 border-b border-border pb-1">
                  <Link
                    href={`/employees/${employee.id}`}
                    className="font-semibold text-sm hover:text-brand-700 hover:underline"
                  >
                    {employee.displayName}
                  </Link>
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
                                  {i === 0 ? formatDayLabel(day, tz) : ""}
                                </td>
                                <td className="py-1 px-3 font-mono">{formatHm(inT, tz)}</td>
                                <td className="py-1 px-3 font-mono">{formatHm(outT, tz)}</td>
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
          })}
        </CardContent>
      </Card>

      <LockButtons period={period} />

      <p className="text-xs text-text-muted">
        Rounding: {payRules.rounding}. Period length: {payPeriod.lengthDays} days.
      </p>
    </div>
  );
}

export const dynamic = "force-dynamic";
