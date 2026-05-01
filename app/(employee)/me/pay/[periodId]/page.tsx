// Employee payslip viewer for a given period. Iframe of the PDF (via the
// /api/payslips/[id]/pdf route, auth-gated server-side) plus an inline
// Acknowledge button that writes audit.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { requireSession } from "@/lib/auth-guards";
import { getPayslipForEmployeePeriod } from "@/lib/db/queries/payslips";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { getSetting } from "@/lib/settings/runtime";
import { AcknowledgeButton } from "./acknowledge-button";

export default async function EmployeePayslipViewer({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const session = await requireSession();
  const { periodId } = await params;
  const period = await getPeriodById(periodId);
  if (!period) notFound();
  if (!session.user.employeeId) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <p className="text-sm text-text-muted">
          Your account is not linked to an employee record.
        </p>
      </div>
    );
  }
  const payslip = await getPayslipForEmployeePeriod(
    session.user.employeeId,
    periodId,
  );
  const payRules = await getSetting("payRules");

  return (
    <div className="space-y-4 p-4 max-w-3xl mx-auto">
      <Button asChild variant="ghost" size="sm">
        <Link href="/me/pay">
          <ArrowLeft className="h-4 w-4" /> All payslips
        </Link>
      </Button>

      {!payslip || !payslip.publishedAt ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {period.startDate} – {period.endDate}
            </CardTitle>
            <CardDescription>
              No payslip yet for this period.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-muted">
              When the run publishes, a PDF lands here automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                {period.startDate} – {period.endDate}
              </CardTitle>
              <CardDescription>
                {payslip.acknowledgedAt
                  ? `Acknowledged ${payslip.acknowledgedAt.toISOString().slice(0, 16).replace("T", " ")}`
                  : "Published — please review and acknowledge."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Stat label="Hours">
                <HoursDisplay
                  hours={Number(payslip.hoursWorked)}
                  decimals={payRules.hoursDecimalPlaces}
                />
              </Stat>
              <Stat label="Gross">
                <MoneyDisplay cents={payslip.grossPayCents} monospace={false} />
              </Stat>
              <Stat label="Net (rounded)">
                <MoneyDisplay cents={payslip.roundedPayCents} monospace={false} />
              </Stat>
            </CardContent>
          </Card>

          {(() => {
            const lower = (payslip.pdfPath ?? "").toLowerCase();
            const isPdf = lower.endsWith(".pdf");
            if (isPdf) {
              return (
                <iframe
                  title={`Payslip ${period.startDate}`}
                  src={`/api/payslips/${payslip.id}/pdf`}
                  className="w-full h-[70vh] rounded-card border border-border bg-surface"
                />
              );
            }
            // Legacy XLSX / non-PDF artifact: download link.
            const fmt = lower.endsWith(".xlsx") || lower.endsWith(".xls")
              ? "Excel spreadsheet"
              : lower.endsWith(".csv")
                ? "CSV file"
                : "file";
            return (
              <Card>
                <CardContent className="p-6 space-y-3 text-sm">
                  <p>
                    This is a legacy payslip exported as an {fmt}. Download it
                    to view the full breakdown.
                  </p>
                  <Button asChild>
                    <a href={`/api/payslips/${payslip.id}/pdf`} download>
                      Download original report
                    </a>
                  </Button>
                </CardContent>
              </Card>
            );
          })()}

          {!payslip.acknowledgedAt && (
            <AcknowledgeButton payslipId={payslip.id} />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="font-semibold text-base">{children}</div>
    </div>
  );
}
