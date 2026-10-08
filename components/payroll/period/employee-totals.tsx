// The employee totals table: one row per employee with hours, pay and issues;
// each row expands to that employee's daily punches.
import type React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HoursDisplay } from "@/components/domain/hours-display";
import { db } from "@/lib/db";
import { and } from "drizzle-orm";
import type { PeriodReview } from "@/lib/db/queries/period-review";
import { EmployeeTotalsMobile } from "@/components/payroll/period/employee-totals-mobile";
import { EmployeeTotalsTable } from "@/components/payroll/period/employee-totals-table";

export function EmployeeTotals({ review, isAccountant }: { review: PeriodReview; isAccountant: boolean }) {
  const { period, punches, payRules, employees, rendered, displayRows, totals } = review;
  return (
    <>
      {/* Per-employee summary — each row expands inline to show that
          employee's punches. Drops the separate Punches card so the
          period detail page no longer requires scrolling past every
          employee twice. */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Employee totals</CardTitle>
            <CardDescription>
              Expand a row to see that employee&apos;s daily punches.
            </CardDescription>
          </div>
          {rendered.length > 0 ? (
            <p className="text-caption text-text-muted tabular-nums">
              {displayRows.length}{" "}
              {displayRows.length === 1 ? "employee" : "employees"}
              {" · "}
              <HoursDisplay
                hours={totals.hours}
                decimals={payRules.hoursDecimalPlaces}
              />{" "}
              h
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {rendered.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-text-muted">
              No punches or task pay recorded for this period.
            </p>
          ) : (
            <>
            <EmployeeTotalsMobile review={review} isAccountant={isAccountant} />

            <EmployeeTotalsTable review={review} isAccountant={isAccountant} />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
