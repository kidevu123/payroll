// Employee payslip viewer. Three-card layout:
//   1. Summary  — hours / gross / net for the period
//   2. Daily    — date | in | out | hours | est. pay per row
//   3. Original — download the legacy report file (only when one exists)
// Plus an Acknowledge button when not yet acknowledged.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown, AlertTriangle, CircleCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { StatusPill } from "@/components/domain/status-pill";
import { requireSession } from "@/lib/auth-guards";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import {
  getPublishedPayslipForEmployeePeriod,
  recomputePayslip,
} from "@/lib/db/queries/payslips";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { getEmployee } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { resolveLocale } from "@/lib/i18n";
import { AcknowledgeButton } from "./acknowledge-button";
import { ReportProblemButton } from "./report-problem-button";

const MS_PER_HOUR = 60 * 60 * 1000;

function fmtTime(d: Date | null, tz: string, locale: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

function fmtDayLabel(iso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(new Date(`${iso}T12:00:00Z`));
}

export default async function EmployeePayslipViewer({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const session = await requireSession();
  const t = await getTranslations("employee.pay");
  const locale = await resolveLocale();
  const dateLocale = locale === "es" ? "es-MX" : "en-US";
  const { periodId } = await params;
  const period = await getPeriodById(periodId);
  if (!period) notFound();
  if (!session.user.employeeId) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <p className="text-sm text-text-muted">
          {t("notLinkedAccount")}
        </p>
      </div>
    );
  }
  let [payslip, payRules, company, employee] = await Promise.all([
    getPublishedPayslipForEmployeePeriod(session.user.employeeId, periodId),
    getSetting("payRules"),
    getSetting("company"),
    getEmployee(session.user.employeeId),
  ]);
  const tz = company.timezone ?? "America/New_York";

  // Self-heal: when the stored payslip total disagrees with the live
  // recompute by more than half an hour, trigger a one-shot recompute
  // server-side. Owner directive: don't show "we noticed your numbers
  // are wrong" without fixing them. PAID-state guard removed — the
  // stored numbers should match reality even after the period is
  // marked paid; the recompute is audited so the change trail is
  // preserved.
  // Salaried payslips MUST NOT self-recompute — pay is set externally
  // (accountant), stored as the actual amount; a recompute would drive it
  // to ~$0 because there are no punches × hourly_rate to sum. Silent
  // corruption on first view. Only HOURLY pay is safe to recompute.
  const canSelfHeal = !!payslip && employee?.payType === "HOURLY";
  if (canSelfHeal && payslip) {
    const live = await listPunches({
      employeeId: payslip.employeeId,
      periodId,
    });
    const deduped = dedupNearDuplicatePunches(
      live.filter((p) => !p.voidedAt),
    );
    let liveHoursMs = 0;
    for (const p of deduped) {
      if (!p.clockOut) continue;
      const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
      const outT =
        p.clockOut instanceof Date ? p.clockOut : new Date(p.clockOut);
      if (outT.getTime() > inT.getTime()) {
        liveHoursMs += outT.getTime() - inT.getTime();
      }
    }
    const liveHours = liveHoursMs / 3_600_000;
    const storedHours = Number(payslip.hoursWorked);
    if (Math.abs(storedHours - liveHours) > 0.5) {
      try {
        await recomputePayslip(payslip.id, {
          id: session.user.id,
          role: session.user.role,
        });
        // Refetch the now-corrected payslip so the body renders the
        // updated numbers without a banner.
        payslip = await getPublishedPayslipForEmployeePeriod(
          session.user.employeeId,
          periodId,
        );
      } catch {
        // Recompute failed — fall through to the existing heads-up
        // banner so the discrepancy is at least visible.
      }
    }
  }

  return (
    <main className="space-y-5 p-4 sm:p-6 max-w-3xl mx-auto">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/me/pay">
          <ArrowLeft className="h-4 w-4" /> All payslips
        </Link>
      </Button>

      {!payslip ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {period.startDate} – {period.endDate}
            </CardTitle>
            <CardDescription>No payslip yet for this period.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-muted leading-relaxed">
              When the run publishes, your payslip lands here automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <PayslipBody
          payslip={payslip}
          period={period}
          payRules={payRules}
          tz={tz}
          rateCents={employee?.hourlyRateCents ?? null}
          payType={employee?.payType ?? "HOURLY"}
        />
      )}
    </main>
  );
}

async function PayslipBody({
  payslip,
  period,
  payRules,
  tz,
  rateCents,
  payType,
}: {
  payslip: NonNullable<Awaited<ReturnType<typeof getPublishedPayslipForEmployeePeriod>>>;
  period: NonNullable<Awaited<ReturnType<typeof getPeriodById>>>;
  payRules: Awaited<ReturnType<typeof getSetting<"payRules">>>;
  tz: string;
  rateCents: number | null;
  payType: "HOURLY" | "FLAT_TASK" | "SALARIED";
}) {
  // Pull every punch the employee has and filter by date range against the
  // employee's display tz — covers cases where punches are stored on a
  // different period_id than the one the payslip is pinned to (e.g. legacy
  // imports where weekly periods bracket the actual report range).
  const all = await listPunches({ employeeId: payslip.employeeId });
  const start = period.startDate;
  const end = period.endDate;
  const inRange = all.filter((p) => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn),
    );
    return day >= start && day <= end && !p.voidedAt;
  });

  // Group by day in employee tz.
  const byDay = new Map<string, typeof inRange>();
  for (const p of inRange) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn),
    );
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  const days = Array.from(byDay.keys()).sort();

  // Compute the actual hours from the deduped punch list. If this disagrees
  // with what's stored on the payslip by more than half an hour, surface
  // both figures with a "this is a legacy import" callout so the employee
  // (and the admin) can see the discrepancy. Otherwise just show the
  // payslip totals as before.
  const dedupedFlat = dedupNearDuplicatePunches(inRange);
  let liveHoursMs = 0;
  for (const p of dedupedFlat) {
    if (!p.clockOut) continue;
    const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
    const outT = p.clockOut instanceof Date ? p.clockOut : new Date(p.clockOut);
    const diff = outT.getTime() - inT.getTime();
    if (diff > 0) liveHoursMs += diff;
  }
  const liveHours = liveHoursMs / 3_600_000;
  const storedHours = Number(payslip.hoursWorked);
  const liveCents =
    rateCents !== null && payType === "HOURLY"
      ? Math.round(liveHours * rateCents)
      : payslip.grossPayCents;
  const discrepancy = Math.abs(storedHours - liveHours) > 0.5;

  const isDisputed = !!payslip.disputedAt && !payslip.disputeResolvedAt;
  const isAcknowledged = !!payslip.acknowledgedAt && !isDisputed;

  return (
    <>
      {/* Hero summary — Net pay is the headline figure. Period dates +
          status pill above; secondary stats (hours / gross) below. The
          "Problem reported" badge is prominent when active. */}
      <Card
        className={
          isDisputed
            ? "relative overflow-hidden before:absolute before:inset-y-5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-warn-700/80"
            : undefined
        }
      >
        <CardContent className="px-6 py-6 sm:px-7 sm:py-7 space-y-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1.5">
              <p className="text-[11px] uppercase tracking-wider text-text-subtle font-medium">
                Pay period
              </p>
              <p className="text-base font-semibold tracking-tight text-text antialiased">
                {period.startDate}{" "}
                <span className="text-text-subtle font-normal">–</span>{" "}
                {period.endDate}
              </p>
            </div>
            {isDisputed ? (
              <span className="inline-flex items-center gap-1.5 rounded-chip border border-warn-200/80 bg-warn-50 px-2.5 py-1 text-[11px] font-medium tracking-tight text-warn-700">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Problem reported
              </span>
            ) : isAcknowledged ? (
              <StatusPill status="APPROVED" />
            ) : (
              <span className="inline-flex items-center gap-1 rounded-chip border border-info-200/80 bg-info-50 px-2 py-0.5 text-[11px] font-medium tracking-tight text-info-700">
                Awaiting review
              </span>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-text-subtle font-medium">
              Net pay
            </p>
            <p className="text-[2.25rem] leading-[1.1] font-semibold tracking-tight tabular-nums text-text antialiased">
              <MoneyDisplay
                cents={payslip.roundedPayCents}
                monospace={false}
              />
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1 border-t border-border/60">
            <HeroStat label="Hours">
              <HoursDisplay
                hours={storedHours}
                decimals={payRules.hoursDecimalPlaces}
                className="font-sans"
              />
            </HeroStat>
            <HeroStat label="Gross">
              <MoneyDisplay
                cents={payslip.grossPayCents}
                monospace={false}
              />
            </HeroStat>
          </div>

          <p className="text-[11px] text-text-muted leading-relaxed">
            {isDisputed
              ? "Admin has been notified about your report and will follow up."
              : isAcknowledged
                ? `Acknowledged ${payslip.acknowledgedAt!.toISOString().slice(0, 16).replace("T", " ")} UTC`
                : "Please review the breakdown below and acknowledge once you're satisfied."}
          </p>

          {discrepancy && (
            <div className="rounded-card border border-warn-200/80 bg-warn-50 p-3.5 text-xs text-warn-700 space-y-1.5 leading-relaxed">
              <p className="font-medium">
                Heads-up: the stored payslip total and the daily breakdown
                disagree.
              </p>
              <p>
                <span className="font-medium">Per the report:</span>{" "}
                <HoursDisplay
                  hours={storedHours}
                  decimals={payRules.hoursDecimalPlaces}
                  className="font-mono"
                />{" "}
                · <MoneyDisplay cents={payslip.grossPayCents} monospace={false} />
              </p>
              <p>
                <span className="font-medium">Per recorded punches:</span>{" "}
                <HoursDisplay
                  hours={liveHours}
                  decimals={payRules.hoursDecimalPlaces}
                  className="font-mono"
                />{" "}
                · <MoneyDisplay cents={liveCents} monospace={false} />
              </p>
              <p>
                Most often this happens on legacy-imported records where the
                old report&apos;s total was copied over but only some of the
                original punches survived the migration. Ask admin to
                reconcile if it matters.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily breakdown</CardTitle>
          <CardDescription>
            Times shown in your local timezone ({tz.replace("_", " ")}).
          </CardDescription>
        </CardHeader>
        <CardContent className="px-2 sm:px-4 py-2">
          {days.length === 0 ? (
            <p className="px-4 py-4 text-sm text-text-muted leading-relaxed">
              No clock-in records on file for this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border/60">
                    <th className="px-3 py-3 font-medium">Day</th>
                    <th className="px-3 py-3 font-medium">In</th>
                    <th className="px-3 py-3 font-medium">Out</th>
                    <th className="px-3 py-3 font-medium text-right">Hours</th>
                    {payType === "HOURLY" && (
                      <th className="px-3 py-3 font-medium text-right">
                        Est. pay
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {days.flatMap((d) => {
                    const list = dedupNearDuplicatePunches(
                      byDay
                        .get(d)!
                        .slice()
                        .sort((a, b) => {
                          const ai =
                            a.clockIn instanceof Date
                              ? a.clockIn
                              : new Date(a.clockIn);
                          const bi =
                            b.clockIn instanceof Date
                              ? b.clockIn
                              : new Date(b.clockIn);
                          return ai.getTime() - bi.getTime();
                        }),
                    );
                    return list.map((p, i) => {
                      const inT =
                        p.clockIn instanceof Date
                          ? p.clockIn
                          : new Date(p.clockIn);
                      const outT = p.clockOut
                        ? p.clockOut instanceof Date
                          ? p.clockOut
                          : new Date(p.clockOut)
                        : null;
                      const hours = outT
                        ? (outT.getTime() - inT.getTime()) / MS_PER_HOUR
                        : null;
                      const estCents =
                        hours !== null &&
                        rateCents !== null &&
                        payType === "HOURLY"
                          ? Math.round(hours * rateCents)
                          : null;
                      return (
                        <tr
                          key={p.id}
                          className="transition-colors hover:bg-surface-2/40"
                        >
                          <td className="px-3 py-3 text-xs font-medium text-text">
                            {i === 0 ? fmtDayLabel(d, tz) : ""}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-text-muted tabular-nums">
                            {fmtTime(inT, tz)}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-text-muted tabular-nums">
                            {fmtTime(outT, tz)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-text">
                            {hours !== null ? hours.toFixed(2) : "—"}
                          </td>
                          {payType === "HOURLY" && (
                            <td className="px-3 py-3 text-right text-xs tabular-nums text-text">
                              {estCents !== null ? (
                                <MoneyDisplay
                                  cents={estCents}
                                  monospace={false}
                                />
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 px-3 text-[11px] text-text-muted leading-relaxed">
            &ldquo;Est. pay&rdquo; is rate × hours per day before the period
            rounding rule (currently{" "}
            {payRules.rounding.toLowerCase().replace(/_/g, " ")}). Your final
            paycheck is the rounded total above.
          </p>
        </CardContent>
      </Card>

      {payslip.pdfPath && payslip.pdfPath.toLowerCase().endsWith(".pdf") ? (
        <Card>
          <CardHeader>
            <CardTitle>Printable payslip</CardTitle>
            <CardDescription>
              The PDF copy your employer published.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <iframe
              title={`Payslip ${period.startDate}`}
              src={`/api/payslips/${payslip.id}/pdf`}
              className="w-full h-[70vh] rounded-input border border-border/70 bg-surface"
            />
          </CardContent>
        </Card>
      ) : payslip.pdfPath ? (
        <Card>
          <CardContent className="p-6 space-y-3 text-sm">
            <p className="text-text-muted leading-relaxed">
              An original spreadsheet is attached for this period.
            </p>
            <Button asChild variant="secondary">
              <a href={`/api/payslips/${payslip.id}/pdf`} download>
                <FileDown className="h-4 w-4" /> Download original report
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Sticky-feeling actions footer. Acknowledge is the primary CTA;
          Report-a-problem stays a quiet ghost. The whole strip sits in a
          slim card so on mobile it visually anchors below the breakdown. */}
      <Card className="bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <CardContent className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ReportProblemButton
            payslipId={payslip.id}
            alreadyDisputed={isDisputed}
          />
          {payslip.acknowledgedAt ? (
            <span className="inline-flex items-center gap-1.5 rounded-input bg-success-50 border border-success-200/80 px-3 py-2 text-xs font-medium text-success-700">
              <CircleCheck className="h-3.5 w-3.5" aria-hidden />
              You acknowledged this payslip
            </span>
          ) : (
            <AcknowledgeButton payslipId={payslip.id} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function HeroStat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5 pt-3">
      <div className="text-[11px] uppercase tracking-wider text-text-subtle font-medium">
        {label}
      </div>
      <div className="text-base font-semibold tracking-tight tabular-nums text-text antialiased">
        {children}
      </div>
    </div>
  );
}

