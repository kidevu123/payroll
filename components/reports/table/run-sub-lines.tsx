"use client";

// The runs of a multi-run period, as indented sub-lines: each keeps its own
// visibility chip, amount and actions.
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import Link from "next/link";
import { MoneyDisplay } from "@/components/domain/money-display";

import { type SharedHandlers } from "@/components/reports/table/shared";
import { VisibilityChip, ZohoBadges } from "@/components/reports/table/cells";
import { RunActions } from "@/components/reports/table/row-actions";
import { formatDate } from "@/lib/reports/table-model";


export function RunSubLines({
  runs,
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
}: { runs: ReportRow[] } & Pick<
  SharedHandlers,
  | "busyId"
  | "confirmDelete"
  | "setConfirmDelete"
  | "onPush"
  | "onRepush"
  | "onPublish"
  | "onDelete"
  | "haute"
  | "boomin"
  | "canManageReports"
>) {
  return (
    <ul className="mt-2.5 space-y-px border-l border-border/60 pl-3 sm:ml-1">
      {runs.map((r) => (
        <li
          key={r.id}
          className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-3"
        >
          <Link
            href={`/payroll/${r.periodId}`}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 hover:text-brand-700"
          >
            <span className="text-micro uppercase text-text-subtle">
              {r.source.replace(/_/g, " ")}
            </span>
            <span className="text-text-subtle">·</span>
            <span className="tabular-nums text-xs tabular-nums text-text-muted">
              {r.id.slice(0, 8)}
            </span>
            <span className="truncate text-[11px] text-text-muted">
              {r.createdByDisplay} ·{" "}
              <span className="tabular-nums">{formatDate(r.postedAt)}</span>
            </span>
          </Link>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <ZohoBadges run={r} haute={haute} boomin={boomin} />
            <VisibilityChip published={r.publishedToPortalAt !== null} />
            <span className="min-w-[5rem] text-right tabular-nums text-sm font-semibold text-text">
              <MoneyDisplay cents={r.amountCents} />
            </span>
            <RunActions
              run={r}
              busyId={busyId}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              onPush={onPush}
              onRepush={onRepush}
              onPublish={onPublish}
              onDelete={onDelete}
              haute={haute}
              boomin={boomin}
              canManageReports={canManageReports}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
