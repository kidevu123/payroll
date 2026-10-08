// The top of the period page: back link and title, then the sticky action bar
// with the state, totals and the lock / publish / pay controls.
import { PdfLink } from "@/components/domain/pdf-link";
import type React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { formatPeriodRange as formatRange } from "@/lib/payroll/format-period";
import { StatusPill } from "@/components/domain/status-pill";
import { SchedulePill } from "@/components/domain/schedule-pill";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { canonicalEndForScheduleName } from "@/lib/payroll/period-boundaries";
import { db } from "@/lib/db";
import { and } from "drizzle-orm";
import { LockButtons } from "@/app/(admin)/payroll/[periodId]/lock-buttons";
import { AssignScheduleButton } from "@/app/(admin)/payroll/[periodId]/assign-schedule-button";
import { PublishPeriodButton } from "@/app/(admin)/payroll/[periodId]/publish-period-button";
import { PeriodDetailBackButton } from "@/app/(admin)/payroll/[periodId]/back-button";
import { formatShortDate, periodDayCount } from "@/lib/payroll/period-view";
import type { PeriodReview } from "@/lib/db/queries/period-review";

export function PeriodHeader({ review, isAccountant }: { review: PeriodReview; isAccountant: boolean }) {
  const { period, payRules, schedules, tz, run, headerScheduleId, headerSchedule, runSchedule, employees, displayRows, totals, tempWorkersTotalCents, periodGrandTotalCents } = review;
  return (
    <>
      {/* Sticky action bar — keeps state pill, totals, primary CTAs visible
          even on long period pages. The lock/mark-paid action used to live at
          page bottom, requiring 3000px of scroll on busy weeks. */}
      {/* Static header (date + Back) sits above the sticky bar. The sticky
          bar holds only the state pills + action buttons so it never
          wraps to a second row at common laptop widths (1100-1300px),
          which was the original "buttons all over the place" complaint. */}
      <div className="space-y-2">
        <PeriodDetailBackButton
          fallbackHref={isAccountant ? "/cash-drawer" : "/payroll"}
        />
        <PageHeader
          title={formatRange(
            period.startDate,
            canonicalEndForScheduleName(
              period.startDate,
              period.endDate,
              runSchedule?.name ?? null,
            ),
          )}
          meta={[
            `${periodDayCount(
              period.startDate,
              canonicalEndForScheduleName(
                period.startDate,
                period.endDate,
                runSchedule?.name ?? null,
              ),
            )}-day period`,
            period.lockedAt
              ? `Locked ${formatShortDate(period.lockedAt, tz)}`
              : null,
            period.paidAt
              ? `Paid ${formatShortDate(period.paidAt, tz)}${
                  period.paymentMethod === "CASH"
                    ? " in cash"
                    : period.paymentMethod === "BANK"
                      ? " by bank"
                      : ""
                }`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      </div>
      {/* Stays in the content column — same card chrome as every section
          below it. The old full-bleed treatment (-mx-8, no side borders)
          read as a stray band floating between the title and the cards.
          Pins flush to the viewport (top-0): the admin shell has no desktop
          topbar — the old top-14 assumed one and left a 56px see-through
          gap above the pinned bar. */}
      <div className="rounded-card border border-border/70 bg-surface/95 p-3 shadow-card backdrop-blur lg:sticky lg:top-0 lg:z-20 lg:px-4 lg:py-2.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusPill status={period.state} />
              <SchedulePill name={headerSchedule?.name ?? null} />
              {!isAccountant && !headerScheduleId && (
                <AssignScheduleButton
                  periodId={period.id}
                  schedules={schedules
                    .filter((s) => s.active !== false)
                    .map((s) => ({
                      id: s.id,
                      name: s.name,
                      kind: s.periodKind as
                        | "WEEKLY"
                        | "BIWEEKLY"
                        | "SEMI_MONTHLY"
                        | "MONTHLY",
                    }))}
                />
              )}
              <span
                className="hidden h-5 w-px bg-border/80 sm:block"
                aria-hidden
              />
              <span className="basis-full text-sm text-text-muted tabular-nums sm:basis-auto">
                {displayRows.length}{" "}
                {displayRows.length === 1 ? "employee" : "employees"}
                {" · "}
                <HoursDisplay
                  hours={totals.hours}
                  decimals={payRules.hoursDecimalPlaces}
                />{" "}
                h{" · "}
                <span className="font-semibold text-text">
                  <MoneyDisplay
                    cents={periodGrandTotalCents}
                    monospace={false}
                  />
                </span>
                {tempWorkersTotalCents > 0 && (
                  <span className="text-xs text-text-muted">
                    {" "}
                    (incl.{" "}
                    <MoneyDisplay
                      cents={tempWorkersTotalCents}
                      monospace={false}
                    />{" "}
                    temp)
                  </span>
                )}
              </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:shrink-0 lg:flex-wrap lg:items-center lg:gap-3">
            {!isAccountant && run?.pdfPath && (
              <Button asChild variant="secondary" size="sm" className="w-full justify-center lg:w-auto">
                <PdfLink
                  href={`/api/reports/${run.id}/pdf`}
                  filename="admin-report.pdf"
                >
                  <Download className="h-4 w-4" /> PDF
                </PdfLink>
              </Button>
            )}
            {!isAccountant && (
              <>
                <PublishPeriodButton
                  periodId={period.id}
                  periodState={period.state}
                  published={!!run?.publishedToPortalAt}
                />
                <LockButtons
                  period={period}
                  incompletePunchCount={displayRows.reduce(
                    (s, r) => s + (r.incomplete ?? 0),
                    0,
                  )}
                  periodGrossRoundedCents={periodGrandTotalCents}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
