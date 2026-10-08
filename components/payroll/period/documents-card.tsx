// The Payroll documents card: signature report, payday signing, cut sheet,
// bank/cash list and the admin-report backup.
import { PdfLink } from "@/components/domain/pdf-link";
import type React from "react";
import { Download, Printer, Scissors, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { and } from "drizzle-orm";
import { CashDenominationButton } from "@/app/(admin)/payroll/[periodId]/cash-denomination-button";
import { PaydaySigningButton } from "@/app/(admin)/payroll/[periodId]/payday-signing-button";
import { backupAdminReportToZohoAction } from "@/app/(admin)/payroll/actions";
import type { PeriodReview } from "@/lib/db/queries/period-review";

export function PeriodDocumentsCard({ review, isAccountant }: { review: PeriodReview; isAccountant: boolean }) {
  const { period, run, cashSummary, periodLabel } = review;
  return (
    <>
      {!isAccountant && (
        <Card>
          <CardHeader className="gap-3 border-b-0 py-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 space-y-1">
              <CardTitle>Payroll documents</CardTitle>
              <CardDescription>
                Print while reviewing. Reports keeps the same documents for
                lookbacks.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
            <Button asChild variant="secondary" size="sm">
              <PdfLink
                href={`/api/payslips/period/${period.id}/signature`}
                filename="signature-report.pdf"
              >
                <Printer className="h-4 w-4" /> Signature report
              </PdfLink>
            </Button>
            <PaydaySigningButton periodId={period.id} periodLabel={periodLabel} />
            <Button asChild variant="secondary" size="sm">
              <PdfLink
                href={`/api/payroll/${period.id}/payslips-cut-sheet`}
                filename="payslip-cut-sheet.pdf"
              >
                <Scissors className="h-4 w-4" /> Pay-slip cut sheet
              </PdfLink>
            </Button>
            <CashDenominationButton
              summary={cashSummary}
              periodLabel={periodLabel}
            />
            <form
              className="contents"
              action={async () => {
                "use server";
                await backupAdminReportToZohoAction(period.id, run?.id ?? null);
              }}
            >
              <Button type="submit" variant="secondary" size="sm">
                <UploadCloud className="h-4 w-4" /> Back up admin report
              </Button>
            </form>
            {run?.pdfPath && (
              <Button asChild variant="secondary" size="sm">
                <PdfLink
                  href={`/api/reports/${run.id}/pdf`}
                  filename="admin-report.pdf"
                >
                  <Download className="h-4 w-4" /> Generated report PDF
                </PdfLink>
              </Button>
            )}
            </div>
          </CardHeader>
        </Card>
      )}
    </>
  );
}
