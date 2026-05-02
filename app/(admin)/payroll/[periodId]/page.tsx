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
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { listRates } from "@/lib/db/queries/rate-history";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { db } from "@/lib/db";
import { taskPayLineItems, payrollRuns, paySchedules } from "@/lib/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { LockButtons } from "./lock-buttons";
import { PublishPortalButton } from "./publish-portal-button";
import { TempWorkersSection } from "./temp-workers-section";
import { listTempWorkers } from "@/lib/db/queries/temp-workers";
import { PayrollDocsSection } from "./payroll-docs-section";
import { listDocs } from "@/lib/db/queries/payroll-documents";
import { PayslipManageSection } from "./payslip-manage-section";
import { listPayslipsForPeriod } from "@/lib/db/queries/payslips";
import { DedupPunchesButton } from "./dedup-button";
import { findDuplicatePunchClusters } from "@/lib/db/queries/punches";

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

  const [allEmployees, punches, payRules, payPeriod, company, schedules, tempWorkers, payrollDocs, allPayslips, duplicateClusters] = await Promise.all([
    listEmployees(),
    listPunches({ periodId }),
    getSetting("payRules"),
    getSetting("payPeriod"),
    getSetting("company"),
    db.select().from(paySchedules),
    listTempWorkers({ periodId }),
    listDocs({ periodId }),
    listPayslipsForPeriod(periodId, { includeVoided: true }),
    findDuplicatePunchClusters({ periodId }),
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

  // Filter employees with the same precedence the publish handler uses:
  //   1. run.cohortEmployeeIds (admin-locked cohort) — strongest signal
  //   2. run.payScheduleId (auto-cohort)
  //   3. all
  // SALARIED staff are excluded from punch-driven views regardless.
  const runCohort: string[] | null = Array.isArray(run?.cohortEmployeeIds)
    ? (run!.cohortEmployeeIds as string[])
    : null;
  const cohortSet = runCohort ? new Set(runCohort) : null;
  const employees = (
    cohortSet
      ? allEmployees.filter((e) => cohortSet.has(e.id))
      : runScheduleId
        ? allEmployees.filter((e) => e.payScheduleId === runScheduleId)
        : allEmployees
  ).filter((e) => e.payType !== "SALARIED");

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
  // Collapse near-duplicates (poll vs CSV producing two rows for the
  // same physical shift). Display + computePay both consume the deduped
  // list so the period detail and the payslip stay consistent.
  for (const [empId, list] of punchesByEmployee) {
    punchesByEmployee.set(empId, dedupNearDuplicatePunches(list));
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
      {/* Sticky action bar — keeps state pill, totals, primary CTAs visible
          even on long period pages. The lock/mark-paid action used to live at
          page bottom, requiring 3000px of scroll on busy weeks. */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-page/95 backdrop-blur border-b border-border">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
              <Link href="/reports">
                <ArrowLeft className="h-4 w-4" /> All reports
              </Link>
            </Button>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight">
                {formatRange(period.startDate, period.endDate)}
              </h1>
              <StatusPill status={period.state} />
              {runSchedule && (
                <span className="rounded-input bg-surface-3 px-2 py-0.5 text-xs text-text-muted">
                  {runSchedule.name}
                </span>
              )}
              <span className="text-sm text-text-muted">
                {rendered.length} emp ·{" "}
                <span className="font-medium text-text">
                  <MoneyDisplay
                    cents={run?.totalAmountCents ?? totals.rounded}
                    monospace={false}
                  />
                </span>
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {run?.pdfPath && (
              <Button asChild variant="secondary" size="sm">
                <Link
                  href={`/api/reports/${run.id}/pdf`}
                  target="_blank"
                  rel="noopener"
                >
                  <Download className="h-4 w-4" /> PDF
                </Link>
              </Button>
            )}
            {run && <PublishPortalButton run={run} />}
            <LockButtons period={period} />
          </div>
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

      <TempWorkersSection
        periodId={periodId}
        initialEntries={tempWorkers}
        locked={period.state === "PAID"}
      />

      <DedupPunchesButton
        periodId={periodId}
        initialClusterCount={duplicateClusters.length}
      />

      <PayslipManageSection
        rows={allPayslips
          .map((p) => {
            const e = allEmployees.find((x) => x.id === p.employeeId);
            if (!e) return null;
            return {
              payslip: {
                id: p.id,
                employeeId: p.employeeId,
                hoursWorked: p.hoursWorked,
                roundedPayCents: p.roundedPayCents,
                voidedAt: p.voidedAt,
                voidReason: p.voidReason,
              },
              employee: { id: e.id, displayName: e.displayName },
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .sort((a, b) =>
            a.employee.displayName.localeCompare(b.employee.displayName),
          )}
      />

      <PayrollDocsSection
        periodId={periodId}
        // Pass ALL active employees so the section can show salaried
        // staff alongside the requires-W2-upload flag list. The section
        // filters internally.
        employees={allEmployees
          .filter((e) => e.status === "ACTIVE")
          .map((e) => ({
            id: e.id,
            displayName: e.displayName,
            requiresW2Upload: e.requiresW2Upload,
            payType: e.payType,
          }))}
        initialDocs={payrollDocs}
        locked={period.state === "PAID"}
      />

      <p className="text-xs text-text-muted">
        Rounding: {payRules.rounding}. Period length: {payPeriod.lengthDays} days.
        {tempWorkers.length > 0 && (
          <>
            {" "}
            Period grand total includes{" "}
            <MoneyDisplay
              cents={tempWorkers.reduce((acc, e) => acc + e.amountCents, 0)}
              monospace={false}
            />{" "}
            in temp / manual labor.
          </>
        )}
      </p>
    </div>
  );
}

export const dynamic = "force-dynamic";
