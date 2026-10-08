"use client";

// Per-run actions on a reports ledger row: View, plus the overflow menu.
import Link from "next/link";
import { Eye } from "lucide-react";
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import type { ZohoOrganization } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";


/** Trailing affordance for a single run: View + overflow menu. Inline
 *  delete-confirm replaces the menu trigger while pending. */
import { RowOverflowMenu } from "@/components/reports/table/row-overflow-menu";

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
