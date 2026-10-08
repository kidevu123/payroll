// Phone layout of the employee totals: one tile per employee, then the
// period subtotal.
import Link from "next/link";
import type React from "react";
import { ChevronRight } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import {
  PayslipPdfActions,
  payslipPdfHref,
} from "@/components/domain/payslip-pdf-actions";
import { formatDayLabel, formatHm, rateLabel } from "@/lib/payroll/period-view";
import { issueLabel } from "@/components/payroll/period/issue-label";
import { PunchSubTable } from "@/components/payroll/period/punch-sub-table";
import type { PeriodReview } from "@/lib/db/queries/period-review";


export function EmployeeTotalsMobile({ review, isAccountant }: { review: PeriodReview; isAccountant: boolean }) {
  const { period, payRules, tz, payslipByEmployee, displayRows, totals } = review;
  return (
    <div className="space-y-3 p-4 md:hidden">
      {displayRows.map((row) => {
        const { employee, result, incomplete, punches } = row;
        const ePunches = punches.filter((p) => !p.voidedAt);
        const slip = payslipByEmployee.get(employee.id);
        const pdfUrl = payslipPdfHref(slip);
        return (
          <details
            key={employee.id}
            className="group rounded-card border border-border bg-surface-2/35"
          >
            <summary className="list-none p-3 [&::-webkit-details-marker]:hidden">
              <div className="flex items-start gap-3">
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-text-subtle transition-transform group-open:rotate-90" />
                <div className="min-w-0 flex-1">
                  {isAccountant ? (
                    <span className="block truncate text-sm font-semibold">
                      {employee.displayName}
                    </span>
                  ) : (
                    <Link
                      href={`/employees/${employee.id}`}
                      className="block truncate text-sm font-semibold hover:text-brand-700 hover:underline underline-offset-2"
                    >
                      {employee.displayName}
                    </Link>
                  )}
                  <div className="mt-0.5 text-xs text-text-muted">
                    {rateLabel(employee)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-semibold tabular-nums">
                    <MoneyDisplay cents={result.roundedCents} />
                  </div>
                  <div className="text-micro uppercase text-text-subtle">
                    Rounded
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-input border border-border/70 bg-surface p-2">
                  <div className="text-micro uppercase text-text-subtle">
                    Hours
                  </div>
                  <div className="mt-1 font-semibold tabular-nums">
                    <HoursDisplay
                      hours={result.totalHours}
                      decimals={payRules.hoursDecimalPlaces}
                    />
                  </div>
                </div>
                <div className="rounded-input border border-border/70 bg-surface p-2">
                  <div className="text-micro uppercase text-text-subtle">
                    Gross
                  </div>
                  <div className="mt-1 font-semibold tabular-nums">
                    <MoneyDisplay cents={result.grossCents} />
                  </div>
                </div>
                <div className="rounded-input border border-border/70 bg-surface p-2">
                  <div className="text-micro uppercase text-text-subtle">
                    Issues
                  </div>
                  <div className="mt-1 truncate text-xs">
                    {issueLabel({
                      incomplete,
                      ...("hoursDrift" in row
                        ? {
                            hoursDrift: row.hoursDrift,
                            storedHours: row.storedHours,
                            liveHours: row.liveHours,
                          }
                        : {}),
                    })}
                  </div>
                </div>
              </div>
              {pdfUrl ? (
                <div className="mt-3 flex justify-end">
                  <PayslipPdfActions
                    url={pdfUrl}
                    printLabel="Print"
                    downloadLabel="PDF"
                    layout="inline"
                  />
                </div>
              ) : null}
            </summary>
            <PunchSubTable
              punches={ePunches}
              tz={tz}
              formatHm={formatHm}
              formatDayLabel={formatDayLabel}
              periodId={period.id}
              employeeId={employee.id}
              canEdit={!isAccountant && period.state !== "PAID"}
              today={new Intl.DateTimeFormat("en-CA", {
                timeZone: tz,
              }).format(new Date())}
            />
          </details>
        );
      })}
      <div className="rounded-card border border-border bg-surface-2 p-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">Employee subtotal</span>
          <span className="font-semibold tabular-nums">
            <MoneyDisplay cents={totals.rounded} />
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-muted">
          <div>
            Hours:{" "}
            <span className="tabular-nums text-text">
              <HoursDisplay
                hours={totals.hours}
                decimals={payRules.hoursDecimalPlaces}
              />
            </span>
          </div>
          <div className="text-right">
            Gross:{" "}
            <span className="tabular-nums text-text">
              <MoneyDisplay cents={totals.gross} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
