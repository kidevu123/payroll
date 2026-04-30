// Employee Pay tab — list of past periods. Phase 4 will dress this up
// with the bottom-nav layout; today it's a functional list.

import Link from "next/link";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PayslipCard } from "@/components/domain/payslip-card";
import { requireSession } from "@/lib/auth-guards";
import { listPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { getSetting } from "@/lib/settings/runtime";

export default async function EmployeePayList() {
  const session = await requireSession();
  if (!session.user.employeeId) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <p className="text-sm text-[--text-muted]">
          Your account is not linked to an employee record.
        </p>
      </div>
    );
  }
  const payslips = await listPayslipsForEmployee(session.user.employeeId);
  const payRules = await getSetting("payRules");
  const periods = await Promise.all(payslips.map((p) => getPeriodById(p.periodId)));

  // Sort newest first.
  const rows = payslips
    .map((p, i) => ({ payslip: p, period: periods[i] }))
    .filter((r): r is { payslip: typeof payslips[number]; period: NonNullable<typeof periods[number]> } => r.period !== null && r.period !== undefined)
    .sort((a, b) => (a.period.startDate < b.period.startDate ? 1 : -1));

  return (
    <div className="space-y-4 p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">My pay</h1>
      {rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payslips yet"
          description="Your first payslip lands here when payroll publishes."
        />
      ) : (
        <div className="space-y-3">
          {rows.map(({ payslip, period }) => (
            <PayslipCard
              key={payslip.id}
              payslipId={payslip.id}
              periodStart={period.startDate}
              periodEnd={period.endDate}
              hours={Number(payslip.hoursWorked)}
              roundedCents={payslip.roundedPayCents}
              hoursDecimalPlaces={payRules.hoursDecimalPlaces}
              state={
                payslip.acknowledgedAt
                  ? "acknowledged"
                  : payslip.publishedAt
                    ? "published"
                    : "pending"
              }
              href={`/pay/${payslip.periodId}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
