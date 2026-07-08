// Employee payslip viewer. Three-card layout:
//   1. Summary  — hours / gross / net for the period
//   2. Daily    — date | in | out | hours | est. pay per row
//   3. Original — download the legacy report file (only when one exists)
// Plus an Acknowledge button when not yet acknowledged.

import Link from "next/link";
import { PdfLink } from "@/components/domain/pdf-link";
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
import { PayslipPdfActions } from "@/components/domain/payslip-pdf-actions";
import { PrintPageButton } from "@/components/employee/print-page-button";

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
      <div className="no-print">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/me/pay">
            <ArrowLeft className="h-4 w-4" /> {t("allPayslips")}
          </Link>
        </Button>
      </div>

      {!payslip ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {period.startDate} – {period.endDate}
            </CardTitle>
            <CardDescription>{t("noPayslip")}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-muted leading-relaxed">
              {t("willAppear")}
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
          dateLocale={dateLocale}
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
  dateLocale,
}: {
  payslip: NonNullable<Awaited<ReturnType<typeof getPublishedPayslipForEmployeePeriod>>>;
  period: NonNullable<Awaited<ReturnType<typeof getPeriodById>>>;
  payRules: Awaited<ReturnType<typeof getSetting<"payRules">>>;
  tz: string;
  rateCents: number | null;
  payType: "HOURLY" | "FLAT_TASK" | "SALARIED";
  dateLocale: string;
}) {
  const t = await getTranslations("employee.pay");
  // Use the same period-scoped punch set the payslip was generated from.
  // Date-range reads can pull rows from duplicate/overlapping legacy
  // periods and make a published payslip look wrong even when its own
  // stored totals are internally consistent.
  const inRange = (await listPunches({
    employeeId: payslip.employeeId,
    periodId: payslip.periodId,
  })).filter((p) => !p.voidedAt);

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

  // Deduped + chronologically sorted punches for a single day. Shared by the
  // mobile stacked-card view and the sm+ table so both render identically.
  function sortedDayPunches(day: string) {
    return dedupNearDuplicatePunches(
      byDay
        .get(day)!
        .slice()
        .sort((a, b) => {
          const ai = a.clockIn instanceof Date ? a.clockIn : new Date(a.clockIn);
          const bi = b.clockIn instanceof Date ? b.clockIn : new Date(b.clockIn);
          return ai.getTime() - bi.getTime();
        }),
    );
  }

  // Normalize one punch into the in/out/hours/est-pay shape both views use.
  function punchRow(p: (typeof inRange)[number]) {
    const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
    const outT = p.clockOut
      ? p.clockOut instanceof Date
        ? p.clockOut
        : new Date(p.clockOut)
      : null;
    const hours = outT ? (outT.getTime() - inT.getTime()) / MS_PER_HOUR : null;
    const estCents =
      hours !== null && rateCents !== null && payType === "HOURLY"
        ? Math.round(hours * rateCents)
        : null;
    return { inT, outT, hours, estCents };
  }

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
  const hasPdf = payslip.pdfPath?.toLowerCase().endsWith(".pdf") ?? false;
  const pdfUrl = hasPdf ? `/api/payslips/${payslip.id}/pdf` : null;

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
                {t("payPeriod")}
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
                {t("problemReported")}
              </span>
            ) : isAcknowledged ? (
              <StatusPill status="APPROVED" />
            ) : (
              <span className="inline-flex items-center gap-1 rounded-chip border border-info-200/80 bg-info-50 px-2 py-0.5 text-[11px] font-medium tracking-tight text-info-700">
                {t("awaitingReview")}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-text-subtle font-medium">
              {t("netPay")}
            </p>
            <p className="text-[2.25rem] leading-[1.1] font-semibold tracking-tight tabular-nums text-text antialiased">
              <MoneyDisplay
                cents={payslip.roundedPayCents}
                monospace={false}
              />
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1 border-t border-border/60">
            <HeroStat label={t("viewerHours")}>
              <HoursDisplay
                hours={storedHours}
                decimals={payRules.hoursDecimalPlaces}
                className="font-sans"
              />
            </HeroStat>
            <HeroStat label={t("viewerGross")}>
              <MoneyDisplay
                cents={payslip.grossPayCents}
                monospace={false}
              />
            </HeroStat>
          </div>

          <p className="text-[11px] text-text-muted leading-relaxed">
            {isDisputed
              ? t("disputedNotice")
              : isAcknowledged
                ? t("acknowledgedNotice", {
                    when: payslip.acknowledgedAt!.toISOString().slice(0, 16).replace("T", " "),
                  })
                : t("reviewAndAcknowledge")}
          </p>

          {discrepancy && (
            <div className="rounded-card border border-warn-200/80 bg-warn-50 p-3.5 text-xs text-warn-700 space-y-1.5 leading-relaxed">
              <p className="font-medium">
                {t("discrepancyHeading")}
              </p>
              <p>
                <span className="font-medium">{t("perReport")}</span>{" "}
                <HoursDisplay
                  hours={storedHours}
                  decimals={payRules.hoursDecimalPlaces}
                  className="font-mono"
                />{" "}
                · <MoneyDisplay cents={payslip.grossPayCents} monospace={false} />
              </p>
              <p>
                <span className="font-medium">{t("perPunches")}</span>{" "}
                <HoursDisplay
                  hours={liveHours}
                  decimals={payRules.hoursDecimalPlaces}
                  className="font-mono"
                />{" "}
                · <MoneyDisplay cents={liveCents} monospace={false} />
              </p>
              <p>
                {t("discrepancyExplain")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {pdfUrl ? (
        <Card className="no-print">
          <CardHeader>
            <CardTitle>{t("printablePayslip")}</CardTitle>
            <CardDescription>{t("printableDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <PayslipPdfActions
              url={pdfUrl}
              printLabel={t("printPayslip")}
              downloadLabel={t("downloadPayslip")}
              className="rounded-input border border-border/70"
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="no-print">
          <CardHeader>
            <CardTitle>{t("printablePayslip")}</CardTitle>
            <CardDescription>{t("printSummaryHint")}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <PrintPageButton label={t("printSummary")} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("dailyBreakdown")}</CardTitle>
          <CardDescription>
            {t("timesShownLocal", { tz: tz.replace("_", " ") })}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 py-2">
          {days.length === 0 ? (
            <p className="px-4 py-4 text-sm text-text-muted leading-relaxed">
              {t("noClockInRecords")}
            </p>
          ) : (
            <>
              {/* Mobile: stacked per-day cards — no horizontal scroll, no
                  tiny table cells. The sm+ table view is hidden here. */}
              <ul className="space-y-2.5 sm:hidden">
                {days.map((d) => {
                  const list = sortedDayPunches(d);
                  return (
                    <li
                      key={d}
                      className="rounded-input border border-border/70 bg-surface px-3 py-3"
                    >
                      <p className="text-sm font-medium tracking-tight text-text antialiased">
                        {fmtDayLabel(d, tz, dateLocale)}
                      </p>
                      <ul className="mt-2 space-y-2">
                        {list.map((p) => {
                          const r = punchRow(p);
                          return (
                            <li
                              key={p.id}
                              className="flex items-center justify-between gap-3 border-t border-border/40 pt-2 first:border-t-0 first:pt-0"
                            >
                              <span className="flex flex-col gap-0.5 text-xs">
                                <span className="text-text-muted">
                                  {t("in")}{" "}
                                  <span className="whitespace-nowrap font-mono tabular-nums text-text">
                                    {fmtTime(r.inT, tz, dateLocale)}
                                  </span>
                                  <span className="mx-1.5 text-text-subtle">
                                    →
                                  </span>
                                  {t("out")}{" "}
                                  <span className="whitespace-nowrap font-mono tabular-nums text-text">
                                    {fmtTime(r.outT, tz, dateLocale)}
                                  </span>
                                </span>
                              </span>
                              <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                                <span className="font-mono text-xs tabular-nums text-text">
                                  {r.hours !== null ? r.hours.toFixed(2) : "—"}
                                  <span className="ml-1 lowercase text-text-subtle">
                                    {t("hours")}
                                  </span>
                                </span>
                                {payType === "HOURLY" && (
                                  <span className="text-xs tabular-nums text-text-muted">
                                    {r.estCents !== null ? (
                                      <MoneyDisplay
                                        cents={r.estCents}
                                        monospace={false}
                                      />
                                    ) : (
                                      "—"
                                    )}
                                  </span>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ul>

              {/* sm+ : the original table layout, no overflow needed at width. */}
              <div className="hidden sm:block">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border/60">
                      <th className="px-3 py-3 font-medium">{t("day")}</th>
                      <th className="px-3 py-3 font-medium">{t("in")}</th>
                      <th className="px-3 py-3 font-medium">{t("out")}</th>
                      <th className="px-3 py-3 font-medium text-right">{t("hours")}</th>
                      {payType === "HOURLY" && (
                        <th className="px-3 py-3 font-medium text-right">
                          {t("estPay")}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {days.flatMap((d) => {
                      const list = sortedDayPunches(d);
                      return list.map((p, i) => {
                        const r = punchRow(p);
                        return (
                          <tr
                            key={p.id}
                            className="transition-colors hover:bg-surface-2/40"
                          >
                            <td className="px-3 py-3 text-xs font-medium text-text">
                              {i === 0 ? fmtDayLabel(d, tz, dateLocale) : ""}
                            </td>
                            <td className="px-3 py-3 font-mono text-xs text-text-muted tabular-nums">
                              {fmtTime(r.inT, tz, dateLocale)}
                            </td>
                            <td className="px-3 py-3 font-mono text-xs text-text-muted tabular-nums">
                              {fmtTime(r.outT, tz, dateLocale)}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-text">
                              {r.hours !== null ? r.hours.toFixed(2) : "—"}
                            </td>
                            {payType === "HOURLY" && (
                              <td className="px-3 py-3 text-right text-xs tabular-nums text-text">
                                {r.estCents !== null ? (
                                  <MoneyDisplay
                                    cents={r.estCents}
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
            </>
          )}
          <p className="mt-3 px-3 text-[11px] text-text-muted leading-relaxed">
            {t("estPayExplain", {
              rounding: payRules.rounding.toLowerCase().replace(/_/g, " "),
            })}
          </p>
        </CardContent>
      </Card>

      {payslip.pdfPath && !hasPdf ? (
        <Card className="no-print">
          <CardContent className="p-6 space-y-3 text-sm">
            <p className="text-text-muted leading-relaxed">
              {t("spreadsheetAttached")}
            </p>
            <Button asChild variant="secondary">
              <PdfLink href={`/api/payslips/${payslip.id}/pdf`} filename="payslip.pdf">
                <FileDown className="h-4 w-4" /> {t("downloadOriginal")}
              </PdfLink>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Sticky-feeling actions footer. Acknowledge is the primary CTA;
          Report-a-problem stays a quiet ghost. The whole strip sits in a
          slim card so on mobile it visually anchors below the breakdown. */}
      <Card className="no-print bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <CardContent className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ReportProblemButton
            payslipId={payslip.id}
            alreadyDisputed={isDisputed}
          />
          {payslip.acknowledgedAt ? (
            <span className="inline-flex items-center gap-1.5 rounded-input bg-success-50 border border-success-200/80 px-3 py-2 text-xs font-medium text-success-700">
              <CircleCheck className="h-3.5 w-3.5" aria-hidden />
              {t("youAcknowledged")}
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
