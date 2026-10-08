"use client";

// Per-run actions on a reports ledger row: View, plus the overflow menu
// (PDFs, publish to portal, Zoho push / re-push, delete).
import Link from "next/link";
import { PdfLink } from "@/components/domain/pdf-link";
import {
  Download,
  Eye,
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
import type { ZohoOrganization } from "@/lib/db/schema";
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
export function RunActions({
  run,
  busyId,
  confirmDelete,
  setConfirmDelete,
  onPush,
  onRepush,
  onPublish,
  onDelete,
  haute,
  boomin,
  canManageReports,
}: {
  run: ReportRow;
  busyId: string | null;
  confirmDelete: string | null;
  setConfirmDelete: (v: string | null) => void;
  onPush: (reportId: string, orgId: string | undefined, label: string) => void;
  onRepush: (
    reportId: string,
    orgId: string | undefined,
    label: string,
    expenseId: string | null,
  ) => void;
  onPublish: (id: string) => void;
  onDelete: (id: string) => void;
  haute: ZohoOrganization | undefined;
  boomin: ZohoOrganization | undefined;
  canManageReports: boolean;
}) {
  const pushedHaute = run.zohoPushes.find((p) => p.orgId === haute?.id);
  const pushedBoomin = run.zohoPushes.find((p) => p.orgId === boomin?.id);
  const published = run.publishedToPortalAt !== null;
  const isLegacy = run.source === "LEGACY_IMPORT";

  if (confirmDelete === run.id) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-input border border-danger-200/80 bg-danger-50 pl-2">
        <span className="text-[11px] font-medium text-danger-700">Delete?</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 px-2 text-[11px]"
          onClick={() => setConfirmDelete(null)}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 px-2 text-[11px] text-danger-700 hover:bg-danger-100"
          disabled={busyId === `${run.id}:delete`}
          onClick={() => onDelete(run.id)}
        >
          {busyId === `${run.id}:delete` ? "…" : "Confirm"}
        </Button>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <Button
        asChild
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0"
        title="Open admin report"
      >
        <Link href={`/payroll/${run.periodId}`}>
          <Eye className="h-4 w-4" />
        </Link>
      </Button>
      <RowOverflowMenu
        runId={run.id}
        periodId={run.periodId}
        published={published}
        isLegacy={isLegacy}
        hasPdf={run.pdfPath !== null}
        busyId={busyId}
        pushedHaute={pushedHaute}
        pushedBoomin={pushedBoomin}
        hauteOrgId={haute?.id}
        boominOrgId={boomin?.id}
        onPublish={() => onPublish(run.id)}
        onPushHaute={() => onPush(run.id, haute?.id, "Haute")}
        onPushBoomin={() => onPush(run.id, boomin?.id, "Boomin")}
        onRepushHaute={() =>
          onRepush(run.id, haute?.id, "Haute", pushedHaute?.expenseId ?? null)
        }
        onRepushBoomin={() =>
          onRepush(run.id, boomin?.id, "Boomin", pushedBoomin?.expenseId ?? null)
        }
        onDeleteRequest={() => setConfirmDelete(run.id)}
        canManage={canManageReports}
      />
    </div>
  );
}

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
