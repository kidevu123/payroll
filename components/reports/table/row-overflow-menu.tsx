"use client";

// The "more" menu on a reports ledger row: PDFs, publish to portal, Zoho push /
// re-push, delete.
import Link from "next/link";
import { PdfLink } from "@/components/domain/pdf-link";
import {
  Download,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  MoreHorizontal,
  Upload,
  FileText,
  Scissors,
} from "lucide-react";
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


/** Trailing affordance for a single run: View + overflow menu. Inline
 *  delete-confirm replaces the menu trigger while pending. */

export function RowOverflowMenu({
  runId,
  periodId,
  published,
  isLegacy,
  hasPdf,
  busyId,
  pushedHaute,
  pushedBoomin,
  hauteOrgId,
  boominOrgId,
  onPublish,
  onPushHaute,
  onPushBoomin,
  onRepushHaute,
  onRepushBoomin,
  onDeleteRequest,
  canManage,
}: {
  runId: string;
  periodId: string;
  published: boolean;
  isLegacy: boolean;
  hasPdf: boolean;
  busyId: string | null;
  pushedHaute: ReportRow["zohoPushes"][number] | undefined;
  pushedBoomin: ReportRow["zohoPushes"][number] | undefined;
  hauteOrgId: string | undefined;
  boominOrgId: string | undefined;
  onPublish: () => void;
  onPushHaute: () => void;
  onPushBoomin: () => void;
  onRepushHaute: () => void;
  onRepushBoomin: () => void;
  onDeleteRequest: () => void;
  canManage: boolean;
}) {
  const publishBusy = busyId === `${runId}:publish`;
  const hauteBusy = busyId === `${runId}:push:${hauteOrgId ?? ""}`;
  const boominBusy = busyId === `${runId}:push:${boominOrgId ?? ""}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="More actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>Documents</DropdownMenuLabel>
        {hasPdf ? (
          <DropdownMenuItem asChild>
            <PdfLink href={`/api/reports/${runId}/pdf`} filename="admin-report.pdf">
              <Download className="h-3.5 w-3.5" /> Download report PDF
            </PdfLink>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <Download className="h-3.5 w-3.5 opacity-40" /> No report PDF
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <PdfLink
            href={`/api/payroll/${periodId}/payslips-cut-sheet`}
            filename="payslip-cut-sheet.pdf"
          >
            <Scissors className="h-3.5 w-3.5" /> Pay-slip cut sheet
          </PdfLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <PdfLink
            href={`/api/payslips/period/${periodId}/signature`}
            filename="signature-report.pdf"
          >
            <Printer className="h-3.5 w-3.5" /> Signature report
          </PdfLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/payroll/${periodId}`}>
            <FileText className="h-3.5 w-3.5" /> Open admin report
          </Link>
        </DropdownMenuItem>

        {canManage && !published && !isLegacy && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Visibility</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={publishBusy}
              onSelect={(e) => {
                e.preventDefault();
                onPublish();
              }}
            >
              <Upload className="h-3.5 w-3.5" />
              {publishBusy ? "Publishing…" : "Publish to portal"}
            </DropdownMenuItem>
          </>
        )}

        {canManage && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Zoho Books</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={hauteBusy}
              onSelect={(e) => {
                e.preventDefault();
                if (pushedHaute) onRepushHaute();
                else onPushHaute();
              }}
            >
              {pushedHaute ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {hauteBusy
                ? "Working…"
                : pushedHaute
                ? "Re-push to Haute"
                : "Push to Haute"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={boominBusy}
              onSelect={(e) => {
                e.preventDefault();
                if (pushedBoomin) onRepushBoomin();
                else onPushBoomin();
              }}
            >
              {pushedBoomin ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {boominBusy
                ? "Working…"
                : pushedBoomin
                ? "Re-push to Boomin"
                : "Push to Boomin"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onSelect={(e) => {
                e.preventDefault();
                onDeleteRequest();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete report…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
