"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  backfillNullRunTotalsAction,
  deleteEmptyOrphanPeriodsAction,
  previewEmptyOrphanPeriodsAction,
  previewOverlappingPeriodsAction,
} from "./actions";

type BackfillRow = {
  runId: string;
  previousTotal: number | null;
  newTotal: number;
};
type OrphanRow = { id: string; startDate: string; endDate: string; state: string };
type OverlapPair = Awaited<
  ReturnType<typeof previewOverlappingPeriodsAction>
>["pairs"][number];

export function CleanupTools() {
  const [backfillResult, setBackfillResult] = React.useState<{
    fixed: BackfillRow[];
    error?: string;
  } | null>(null);
  const [orphans, setOrphans] = React.useState<OrphanRow[] | null>(null);
  const [orphanDeleted, setOrphanDeleted] = React.useState<
    { id: string; startDate: string; endDate: string }[] | null
  >(null);
  const [overlaps, setOverlaps] = React.useState<OverlapPair[] | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function onBackfill() {
    setPending("backfill");
    setError(null);
    const r = await backfillNullRunTotalsAction();
    setPending(null);
    if (r.error) setError(r.error);
    setBackfillResult(r);
  }

  async function onPreviewOrphans() {
    setPending("orphan-preview");
    setError(null);
    const r = await previewEmptyOrphanPeriodsAction();
    setPending(null);
    if (r.error) setError(r.error);
    setOrphans(r.candidates);
  }

  async function onDeleteOrphans() {
    if (!orphans || orphans.length === 0) return;
    const ok = window.confirm(
      `Delete ${orphans.length} empty orphan period${
        orphans.length === 1 ? "" : "s"
      }? Each is verified zero-data (no runs, payslips, temp workers, punches, or documents). Audit row written per delete.`,
    );
    if (!ok) return;
    setPending("orphan-delete");
    setError(null);
    const r = await deleteEmptyOrphanPeriodsAction();
    setPending(null);
    if (r.error) setError(r.error);
    setOrphanDeleted(r.deleted);
    setOrphans(null);
  }

  async function onPreviewOverlaps() {
    setPending("overlap-preview");
    setError(null);
    const r = await previewOverlappingPeriodsAction();
    setPending(null);
    if (r.error) setError(r.error);
    setOverlaps(r.pairs);
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-input border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 1. Backfill NULL run totals */}
      <section className="rounded-card border border-border bg-surface-2 p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-brand-700" />
            Backfill NULL run totals
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Some PUBLISHED runs (typically MANUAL_CSV) have a NULL{" "}
            <code className="bg-surface px-1 rounded">total_amount_cents</code>.
            UI components fall back to recompute, but the column should be
            populated for /reports listings + CSV exports. Recomputes from
            the run&apos;s non-voided payslips. Audited per fix.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending !== null}
          onClick={onBackfill}
        >
          {pending === "backfill" ? "Running…" : "Backfill now"}
        </Button>
        {backfillResult && (
          <div className="rounded-input border border-emerald-200 bg-emerald-50 p-3 text-xs">
            <p className="font-medium text-emerald-900">
              {backfillResult.fixed.length === 0
                ? "Nothing to fix — all PUBLISHED runs have a stored total."
                : `Fixed ${backfillResult.fixed.length} run${
                    backfillResult.fixed.length === 1 ? "" : "s"
                  }.`}
            </p>
            {backfillResult.fixed.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-emerald-900">
                {backfillResult.fixed.map((r) => (
                  <li key={r.runId}>
                    <code className="font-mono">{r.runId.slice(0, 8)}</code>:{" "}
                    NULL → ${(r.newTotal / 100).toFixed(2)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* 2. Empty orphan periods */}
      <section className="rounded-card border border-border bg-surface-2 p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-brand-700" />
            Empty orphan pay periods
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Periods that ended up in the database with{" "}
            <strong>zero data attached</strong> (no runs, no payslips, no
            temp workers, no punches, no documents) — typically legacy
            schedule-rollover ghosts. Preview first; delete is hard but
            fully audited and re-verifies emptiness inside the transaction.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending !== null}
            onClick={onPreviewOrphans}
          >
            {pending === "orphan-preview" ? "Loading…" : "Preview candidates"}
          </Button>
          {orphans && orphans.length > 0 && (
            <Button
              size="sm"
              variant="destructive"
              disabled={pending !== null}
              onClick={onDeleteOrphans}
            >
              {pending === "orphan-delete"
                ? "Deleting…"
                : `Delete ${orphans.length}`}
            </Button>
          )}
        </div>
        {orphans && (
          <div
            className={`rounded-input border p-3 text-xs ${
              orphans.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {orphans.length === 0 ? (
              <p>
                <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" /> No empty
                orphan periods. Database is clean on this dimension.
              </p>
            ) : (
              <>
                <p className="mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {orphans.length} period{orphans.length === 1 ? "" : "s"}{" "}
                  empty. Click Delete to remove.
                </p>
                <ul className="space-y-0.5">
                  {orphans.map((o) => (
                    <li key={o.id}>
                      <code className="font-mono">{o.id.slice(0, 8)}</code> ·{" "}
                      {o.startDate} → {o.endDate} · {o.state}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {orphanDeleted && orphanDeleted.length > 0 && (
          <div className="rounded-input border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
            <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
            Deleted {orphanDeleted.length} period
            {orphanDeleted.length === 1 ? "" : "s"}.
          </div>
        )}
      </section>

      {/* 3. Overlapping periods (review-only) */}
      <section className="rounded-card border border-border bg-surface-2 p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-700" />
            Overlapping pay periods
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Periods on the same pay schedule whose date ranges overlap.
            Each pair carries real payslips on BOTH sides — totals
            referencing one period get double-counted across the pair.
            Auto-merge isn&apos;t safe (you choose the survivor + the
            losers&apos; payslips need re-parenting). Preview only;
            cleanup is manual via the existing delete-period flow on the
            wrong period after re-pointing its payslips.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending !== null}
          onClick={onPreviewOverlaps}
        >
          {pending === "overlap-preview" ? "Loading…" : "Preview overlaps"}
        </Button>
        {overlaps && (
          <div
            className={`rounded-input border p-3 text-xs ${
              overlaps.length > 0
                ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            {overlaps.length === 0 ? (
              <p>
                <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" /> No
                overlapping periods.
              </p>
            ) : (
              <>
                <p className="mb-2">
                  {overlaps.length} pair
                  {overlaps.length === 1 ? "" : "s"} found. Review and decide
                  which to keep.
                </p>
                <ul className="space-y-1.5 max-h-96 overflow-y-auto">
                  {overlaps.map((p) => (
                    <li
                      key={`${p.a.id}|${p.b.id}`}
                      className="border-b border-amber-300/50 pb-1.5"
                    >
                      <div>
                        <code className="font-mono">{p.a.id.slice(0, 8)}</code>:{" "}
                        {p.a.startDate} → {p.a.endDate} · {p.a.state} ·{" "}
                        {p.aPayslips} payslips
                      </div>
                      <div>
                        <code className="font-mono">{p.b.id.slice(0, 8)}</code>:{" "}
                        {p.b.startDate} → {p.b.endDate} · {p.b.state} ·{" "}
                        {p.bPayslips} payslips
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
