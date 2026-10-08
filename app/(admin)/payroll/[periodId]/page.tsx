// Per-period admin report. v1.2 layout: two sections, one scroll.
//   • Top: employee totals (name | hours | gross | rounded | publish-pill)
//   • Bottom: punches chronologically per employee (in/out/hours per day)
// Reused for both legacy LEGACY_IMPORT runs and live cron-generated runs.

import { notFound } from "next/navigation";
import type React from "react";
import { MoneyDisplay } from "@/components/domain/money-display";
import { TempWorkersSection } from "./temp-workers-section";
import { PayrollDocsSection } from "./payroll-docs-section";
import { PayslipManageSection } from "./payslip-manage-section";
import { DedupPunchesButton } from "./dedup-button";
import { requireSession } from "@/lib/auth-guards";
import { loadPeriodReview } from "@/lib/db/queries/period-review";
import { PeriodDocumentsCard } from "@/components/payroll/period/documents-card";
import { EmployeeTotals } from "@/components/payroll/period/employee-totals";
import { PeriodAlerts } from "@/components/payroll/period/period-alerts";
import { PeriodHeader } from "@/components/payroll/period/period-header";
import { SignOffCard } from "@/components/payroll/period/sign-off-card";
import { ROUNDING_LABEL } from "@/lib/payroll/period-view";

export default async function PeriodReviewPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const session = await requireSession();
  const isAccountant = session.user.role === "ACCOUNTANT";
  const { periodId } = await params;
  const review = await loadPeriodReview(periodId);
  if (!review) notFound();
  const {
    period,
    allEmployees,
    payRules,
    tempWorkers,
    allPayslips,
    payrollDocs,
    duplicateDetails,
    runSchedule,
  } = review;

  return (
    <div className="space-y-5">
      <PeriodHeader review={review} isAccountant={isAccountant} />

      <PeriodDocumentsCard review={review} isAccountant={isAccountant} />

      <SignOffCard review={review} />

      <PeriodAlerts review={review} isAccountant={isAccountant} />

      <EmployeeTotals review={review} isAccountant={isAccountant} />

      <TempWorkersSection
        periodId={periodId}
        initialEntries={tempWorkers}
        locked={isAccountant || period.state === "PAID"}
      />

      {!isAccountant && (
        <DedupPunchesButton
          periodId={periodId}
          initialDetails={duplicateDetails}
        />
      )}

      {!isAccountant && (
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
                  pdfPath: p.pdfPath,
                },
                employee: { id: e.id, displayName: e.displayName },
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
            .sort((a, b) =>
              a.employee.displayName.localeCompare(b.employee.displayName),
            )}
        />
      )}

      <PayrollDocsSection
        periodId={periodId}
        periodPayScheduleId={period.payScheduleId ?? null}
        periodKind={runSchedule?.periodKind ?? null}
        // Pass ALL active employees so the section can show salaried
        // staff alongside the requires-W2-upload flag list. The section
        // filters internally by requiresW2Upload AND schedule match,
        // and excludes salaried-on-weekly as a defensive measure.
        employees={allEmployees
          .filter((e) => e.status === "ACTIVE")
          .map((e) => ({
            id: e.id,
            displayName: e.displayName,
            requiresW2Upload: e.requiresW2Upload,
            payType: e.payType,
            payScheduleId: e.payScheduleId,
          }))}
        initialDocs={payrollDocs}
        locked={isAccountant || period.state === "PAID"}
      />

      <p className="text-xs text-text-subtle">
        {ROUNDING_LABEL[payRules.rounding]}.
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
