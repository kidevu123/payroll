// Banners between the sign-off card and the totals table: the stored-vs-live
// hours drift warning and employee-raised payslip disputes.
import type React from "react";
import { db } from "@/lib/db";
import { and } from "drizzle-orm";
import { RecomputeBanner } from "@/app/(admin)/payroll/[periodId]/recompute-banner";
import { DisputesPanel } from "@/app/(admin)/payroll/[periodId]/disputes-panel";
import type { PeriodReview } from "@/lib/db/queries/period-review";

export function PeriodAlerts({ review, isAccountant }: { review: PeriodReview; isAccountant: boolean }) {
  const { period, allEmployees, punches, allPayslips, employees, displayRows } = review;
  return (
    <>
      {/* Drift banner — shows when stored payslip hours diverge from
          live punch hours. Lets the admin recompute every doubled
          payslip from current punches in one click. Critical for
          fixing the legacy-import 2x bug across 15+ employees on a
          single period. */}
      {/* Employee-raised disputes — surfaces "Report a problem" reports
          from /me/pay so admin can see them and one-tap resolve. */}
      {!isAccountant && (
        <>
          <DisputesPanel
            disputes={allPayslips
              .filter((p) => p.disputedAt && !p.disputeResolvedAt && !p.voidedAt)
              .map((p) => {
                const emp = allEmployees.find((e) => e.id === p.employeeId);
                return {
                  payslipId: p.id,
                  employeeName: emp?.displayName ?? "Unknown",
                  reason: p.disputeReason ?? "",
                  disputedAt: (p.disputedAt as Date).toISOString(),
                };
              })}
          />

          <RecomputeBanner
            periodId={period.id}
            drifts={
              (displayRows
                .filter((r) => "hoursDrift" in r && r.hoursDrift)
                .map((r) => {
                  const row = r as typeof r & {
                    storedHours?: number;
                    liveHours?: number;
                  };
                  return {
                    employeeName: row.employee.displayName,
                    storedHours: row.storedHours ?? 0,
                    liveHours: row.liveHours ?? 0,
                  };
                })) as Array<{
                employeeName: string;
                storedHours: number;
                liveHours: number;
              }>
            }
          />
        </>
      )}
    </>
  );
}
