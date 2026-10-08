// Desktop layout of the employee totals: an expandable grid, one row per
// employee, with subtotal and grand-total rows.
import Link from "next/link";
import type React from "react";
import { ChevronRight } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { db } from "@/lib/db";
import { and } from "drizzle-orm";
import {
  PayslipPdfActions,
  payslipPdfHref,
} from "@/components/domain/payslip-pdf-actions";
import { formatDayLabel, formatHm, rateLabel } from "@/lib/payroll/period-view";
import { issueLabel } from "@/components/payroll/period/issue-label";
import { PunchSubTable } from "@/components/payroll/period/punch-sub-table";
import type { PeriodReview } from "@/lib/db/queries/period-review";


export function EmployeeTotalsTable({ review, isAccountant }: { review: PeriodReview; isAccountant: boolean }) {
  const { period, punches, payRules, tz, employees, payslipByEmployee, displayRows, totals, tempWorkersTotalCents, periodGrandTotalCents } = review;
  return (
    <div className="hidden overflow-x-auto md:block">
      <div className="min-w-[820px]">
      <div className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] items-center gap-x-4 border-b border-border/60 bg-surface-2/40 px-5 py-2.5 text-micro uppercase text-text-subtle">
        <div></div>
        <div>Employee</div>
        <div className="text-right">Hours</div>
        <div className="text-right">Gross</div>
        <div className="text-right">Rounded</div>
        <div className="text-right">Issues</div>
        <div className="text-right">Payslip</div>
      </div>
      <div className="divide-y divide-border/60">
        {displayRows.map((row) => {
          const { employee, result, incomplete, punches } = row;
          const ePunches = punches.filter((p) => !p.voidedAt);
          const slip = payslipByEmployee.get(employee.id);
          const pdfUrl = payslipPdfHref(slip);
          return (
            <details key={employee.id} className="group">
              <summary className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] cursor-pointer list-none items-center gap-x-4 px-5 py-3 text-sm transition-colors hover:bg-surface-2/40 group-open:bg-surface-2/30 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-4 w-4 text-text-subtle transition-transform group-open:rotate-90" />
                <div className="flex min-w-0 flex-col gap-0.5">
                  {isAccountant ? (
                    <span className="block truncate font-semibold">
                      {employee.displayName}
                    </span>
                  ) : (
                    <Link
                      href={`/employees/${employee.id}`}
                      className="font-semibold hover:text-brand-700 hover:underline underline-offset-2 truncate block"
                    >
                      {employee.displayName}
                    </Link>
                  )}
                  <div className="text-xs text-text-muted tabular-nums">
                    {rateLabel(employee)}
                  </div>
                </div>
                <span className="text-right tabular-nums">
                  <HoursDisplay
                    hours={result.totalHours}
                    decimals={payRules.hoursDecimalPlaces}
                  />
                </span>
                <span className="text-right tabular-nums">
                  <MoneyDisplay cents={result.grossCents} />
                </span>
                <span className="text-right tabular-nums font-semibold">
                  <MoneyDisplay cents={result.roundedCents} />
                </span>
                <span className="truncate text-right text-xs">
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
                </span>
                <span className="flex justify-end">
                  {pdfUrl ? (
                    <PayslipPdfActions
                      url={pdfUrl}
                      printLabel="Print"
                      downloadLabel="PDF"
                      layout="inline"
                    />
                  ) : (
                    <span className="text-xs text-text-subtle">—</span>
                  )}
                </span>
              </summary>
              <PunchSubTable punches={ePunches} tz={tz} formatHm={formatHm} formatDayLabel={formatDayLabel} periodId={period.id} employeeId={employee.id} canEdit={!isAccountant && period.state !== "PAID"} today={new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date())} />
            </details>
          );
        })}
      </div>
      <div className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] items-center gap-x-4 border-t border-border bg-surface-2/40 px-5 py-3 text-sm font-medium">
        <div></div>
        <div>Subtotal</div>
        <div className="text-right tabular-nums">
          <HoursDisplay
            hours={totals.hours}
            decimals={payRules.hoursDecimalPlaces}
          />
        </div>
        <div className="text-right tabular-nums">
          <MoneyDisplay cents={totals.gross} />
        </div>
        <div className="text-right font-semibold tabular-nums">
          <MoneyDisplay cents={totals.rounded} />
        </div>
        <div></div>
        <div></div>
      </div>
      {tempWorkersTotalCents > 0 && (
        <div className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] items-center gap-x-4 bg-surface-2/40 px-5 py-1.5 text-xs text-text-muted">
          <div></div>
          <div>+ Temp / manual labor</div>
          <div></div>
          <div></div>
          <div className="text-right tabular-nums">
            <MoneyDisplay cents={tempWorkersTotalCents} />
          </div>
          <div></div>
          <div></div>
        </div>
      )}
      {tempWorkersTotalCents > 0 && (
        <div className="grid grid-cols-[1.5rem_minmax(180px,2fr)_1fr_1fr_1fr_1.5fr_6.5rem] items-center gap-x-4 border-t border-border bg-surface-2/40 px-5 py-3 text-sm font-semibold">
          <div></div>
          <div>Period grand total</div>
          <div></div>
          <div></div>
          <div className="text-right tabular-nums">
            <MoneyDisplay cents={periodGrandTotalCents} />
          </div>
          <div></div>
          <div></div>
        </div>
      )}
    </div>
    </div>
  );
}
