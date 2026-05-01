// Employee Pay tab — list of payslips on runs the admin has published to
// the portal (payroll_runs.published_to_portal_at IS NOT NULL). Internal
// runs never appear here.

import Link from "next/link";
import { Download, FileText, Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PayslipCard } from "@/components/domain/payslip-card";
import { requireSession } from "@/lib/auth-guards";
import { listPublishedPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { listEmployeeVisibleDocs } from "@/lib/db/queries/payroll-documents";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { getSetting } from "@/lib/settings/runtime";

export default async function EmployeePayList() {
  const session = await requireSession();
  if (!session.user.employeeId) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <p className="text-sm text-text-muted">
          Your account is not linked to an employee record.
        </p>
      </div>
    );
  }
  const [payslips, payRules, payrollDocs] = await Promise.all([
    listPublishedPayslipsForEmployee(session.user.employeeId),
    getSetting("payRules"),
    listEmployeeVisibleDocs(session.user.employeeId),
  ]);
  const periods = await Promise.all(payslips.map((p) => getPeriodById(p.periodId)));

  // Sort newest first.
  const rows = payslips
    .map((p, i) => ({ payslip: p, period: periods[i] }))
    .filter((r): r is { payslip: typeof payslips[number]; period: NonNullable<typeof periods[number]> } => r.period !== null && r.period !== undefined)
    .sort((a, b) => (a.period.startDate < b.period.startDate ? 1 : -1));

  return (
    <div className="space-y-6 p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold">My pay</h1>

      {payrollDocs.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-text-muted">
            Documents from your employer
          </h2>
          <ul className="space-y-2">
            {payrollDocs.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-card border border-border bg-surface p-3 shadow-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-text-muted shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {d.originalFilename}
                    </p>
                    <p className="text-xs text-text-muted">
                      {d.kind} · uploaded{" "}
                      {d.uploadedAt.toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                </div>
                <Link
                  href={`/api/payroll-docs/${d.id}`}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-1 rounded-input border border-border px-2.5 py-1.5 text-sm hover:bg-surface-2"
                >
                  <Download className="h-3.5 w-3.5" /> View
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 && payrollDocs.length === 0 ? (
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
              href={`/me/pay/${payslip.periodId}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
