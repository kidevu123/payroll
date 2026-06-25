"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  backfillNullRunTotalsAction,
  deleteEmptyOrphanPeriodsAction,
  mergeAllOverlapsAction,
  mergeOverlappingPairAction,
  previewEmptyOrphanPeriodsAction,
  previewOverlappingPeriodsAction,
  previewPeriodEmployeeSummaryAction,
  tagLegacyPeriodsBySchedule_Action,
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
  const [tagResult, setTagResult] = React.useState<{
    weekly: number;
    semiMonthly: number;
    skippedAmbiguous: number;
  } | null>(null);
  const [mergeAllResult, setMergeAllResult] = React.useState<{
    merged: number;
    skipped: number;
    errors: Array<{ pair: string; error: string }>;
  } | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function onTagLegacy() {
    setPending("tag-legacy");
    setError(null);
    const r = await tagLegacyPeriodsBySchedule_Action();
    setPending(null);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.result) setTagResult(r.result);
  }

  async function onMergeAll() {
    if (!overlaps || overlaps.length === 0) return;
    const ok = window.confirm(
      `Merge ALL ${overlaps.length} overlapping pair${overlaps.length === 1 ? "" : "s"} using the suggested survivor for each?\n\nFor every pair, the side with more payslips wins (PAID-state breaks ties). Loser-side payslips for the same employee get voided + hard-deleted on collision; loser-side runs/punches/temp/docs re-point to the survivor; the loser period is then deleted. One audit row per merge.\n\nThis is irreversible.`,
    );
    if (!ok) return;
    setPending("merge-all");
    setError(null);
    setMergeAllResult(null);
    const r = await mergeAllOverlapsAction();
    setPending(null);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.result) {
      setMergeAllResult(r.result);
      // Refresh the overlap list — should now be empty (or just the
      // failed pairs).
      const refresh = await previewOverlappingPeriodsAction();
      setOverlaps(refresh.pairs ?? []);
    }
  }

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
        <div className="rounded-input border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
          {error}
        </div>
      )}

      {/* 0. Tag legacy NULL-schedule periods by length (run BEFORE merge) */}
      <section className="rounded-card border border-border bg-surface-2 p-4 space-y-3">
        <div>
          <h2 className="text-heading font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-brand-700" />
            Tag legacy periods by schedule
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Legacy-imported pay periods have <code className="bg-surface px-1 rounded">pay_schedule_id IS NULL</code> —
            so the duplicate-period finder treats a 7-day weekly period
            and a 16-day semi-monthly period that share dates as duplicates
            even though they&apos;re different workflows. Backfill the
            schedule by length: 5-7 days → Weekly, 13-16 days → Semi-Monthly.
            Run this BEFORE merging overlap pairs to avoid bogus matches.
            Audited per period.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending !== null}
          onClick={onTagLegacy}
        >
          {pending === "tag-legacy" ? "Running…" : "Tag legacy periods"}
        </Button>
        {tagResult && (
          <div className="rounded-input border border-success-200 bg-success-50 p-3 text-xs text-success-900">
            <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
            Tagged {tagResult.weekly} weekly + {tagResult.semiMonthly}{" "}
            semi-monthly periods.
            {tagResult.skippedAmbiguous > 0 && (
              <>
                {" "}
                Skipped {tagResult.skippedAmbiguous} ambiguous period
                {tagResult.skippedAmbiguous === 1 ? "" : "s"} (length not in
                5-7 or 13-16 day buckets).
              </>
            )}
          </div>
        )}
      </section>

      {/* 1. Backfill NULL run totals */}
      <section className="rounded-card border border-border bg-surface-2 p-4 space-y-3">
        <div>
          <h2 className="text-heading font-semibold flex items-center gap-2">
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
          <div className="rounded-input border border-success-200 bg-success-50 p-3 text-xs">
            <p className="font-medium text-success-900">
              {backfillResult.fixed.length === 0
                ? "Nothing to fix — all PUBLISHED runs have a stored total."
                : `Fixed ${backfillResult.fixed.length} run${
                    backfillResult.fixed.length === 1 ? "" : "s"
                  }.`}
            </p>
            {backfillResult.fixed.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-success-900">
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
          <h2 className="text-heading font-semibold flex items-center gap-2">
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
                ? "border-warning-200 bg-warning-50 text-warning-900"
                : "border-success-200 bg-success-50 text-success-900"
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
          <div className="rounded-input border border-success-200 bg-success-50 p-3 text-xs text-success-900">
            <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
            Deleted {orphanDeleted.length} period
            {orphanDeleted.length === 1 ? "" : "s"}.
          </div>
        )}
      </section>

      {/* 3. Overlapping periods — inline merge per pair */}
      <section className="rounded-card border border-border bg-surface-2 p-4 space-y-3">
        <div>
          <h2 className="text-heading font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning-700" />
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
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending !== null}
            onClick={onPreviewOverlaps}
          >
            {pending === "overlap-preview" ? "Loading…" : "Preview overlaps"}
          </Button>
          {overlaps && overlaps.length > 0 && (
            <Button
              size="sm"
              variant="default"
              disabled={pending !== null}
              onClick={onMergeAll}
              title="Apply the suggested survivor on every pair in one shot. The suggested side (more payslips, PAID > others) wins; the loser's payslips are voided + hard-deleted on collision, runs/punches/temp/docs re-point to the survivor. Audited per pair."
            >
              {pending === "merge-all"
                ? "Merging…"
                : `Merge all ${overlaps.length} pairs (suggested)`}
            </Button>
          )}
        </div>
        {mergeAllResult && (
          <div
            className={`rounded-input border p-3 text-xs ${
              mergeAllResult.errors.length > 0
                ? "border-warning-200 bg-warning-50 text-warning-900"
                : "border-success-200 bg-success-50 text-success-900"
            }`}
          >
            <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
            Merged {mergeAllResult.merged} pair
            {mergeAllResult.merged === 1 ? "" : "s"}.
            {mergeAllResult.skipped > 0 && (
              <> Skipped {mergeAllResult.skipped} (see errors below).</>
            )}
            {mergeAllResult.errors.length > 0 && (
              <ul className="mt-2 space-y-0.5">
                {mergeAllResult.errors.map((e, i) => (
                  <li key={i}>
                    <code className="font-mono">{e.pair}</code>: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {overlaps && (
          <div
            className={`rounded-input border p-3 text-xs ${
              overlaps.length > 0
                ? "border-warning-200 bg-warning-50 text-warning-900"
                : "border-success-200 bg-success-50 text-success-900"
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
                  {overlaps.length === 1 ? "" : "s"} found. For each pair,
                  click <strong>Keep</strong> on the row you want to survive
                  — the other row&apos;s payslips/runs/punches/temp/docs
                  re-point onto the survivor and the loser period is deleted.
                  Duplicate (employee, period) payslips are voided on the
                  loser side, kept on the survivor. Audited per merge.
                </p>
                <ul className="space-y-2 max-h-[32rem] overflow-y-auto">
                  {overlaps.map((p) => (
                    <OverlapPairRow
                      key={`${p.a.id}|${p.b.id}`}
                      pair={p}
                      onMerged={() => {
                        // Drop the merged pair from the local list (and any
                        // other pair that referenced the now-deleted loser).
                        setOverlaps((prev) =>
                          prev?.filter(
                            (x) =>
                              x.a.id !== p.b.id &&
                              x.b.id !== p.b.id &&
                              x.a.id !== p.a.id &&
                              x.b.id !== p.a.id,
                          ) ?? null,
                        );
                      }}
                    />
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

function OverlapPairRow({
  pair,
  onMerged,
}: {
  pair: OverlapPair;
  onMerged: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  // Suggest the row with more payslips as survivor; tie-break PAID > others.
  const suggestedSurvivor =
    pair.aPayslips > pair.bPayslips
      ? pair.a.id
      : pair.bPayslips > pair.aPayslips
        ? pair.b.id
        : pair.a.state === "PAID" && pair.b.state !== "PAID"
          ? pair.a.id
          : pair.b.state === "PAID" && pair.a.state !== "PAID"
            ? pair.b.id
            : pair.a.id;

  async function onKeep(survivorId: string, loserId: string) {
    const survivor = survivorId === pair.a.id ? pair.a : pair.b;
    const loser = loserId === pair.a.id ? pair.a : pair.b;
    const survivorSlips =
      survivorId === pair.a.id ? pair.aPayslips : pair.bPayslips;
    const loserSlips =
      loserId === pair.a.id ? pair.aPayslips : pair.bPayslips;
    const ok = window.confirm(
      `Keep ${survivor.startDate} → ${survivor.endDate} (${survivor.state}, ${survivorSlips} payslips), delete ${loser.startDate} → ${loser.endDate} (${loser.state}, ${loserSlips} payslips)?\n\nAll loser payslips/runs/punches/temp/docs re-point onto the survivor. Duplicate-employee payslips on both sides are voided on the loser. Audited.`,
    );
    if (!ok) return;
    setPending(true);
    setError(null);
    const r = await mergeOverlappingPairAction(survivorId, loserId);
    setPending(false);
    if (r.error) {
      setError(r.error);
      return;
    }
    if (r.result) {
      setDone(
        `Merged. Moved ${r.result.movedPayslips} payslips, ${r.result.movedRuns} runs, ${r.result.movedPunches} punches, ${r.result.movedTempWorkers} temp, ${r.result.movedDocuments} docs. Voided ${r.result.voidedDuplicatePayslips} duplicate payslips.`,
      );
      // Brief pause so the admin sees the success summary, then prune
      // this row from the parent list.
      setTimeout(onMerged, 1200);
    }
  }

  if (done) {
    return (
      <li className="border-b border-success-200/50 pb-2 text-success-900">
        <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
        {done}
      </li>
    );
  }

  return (
    <li className="border-b border-warning-200/50 pb-2 space-y-1">
      <PairSide
        side={pair.a}
        payslips={pair.aPayslips}
        suggested={suggestedSurvivor === pair.a.id}
        onKeep={() => onKeep(pair.a.id, pair.b.id)}
        pending={pending}
      />
      <PairSide
        side={pair.b}
        payslips={pair.bPayslips}
        suggested={suggestedSurvivor === pair.b.id}
        onKeep={() => onKeep(pair.b.id, pair.a.id)}
        pending={pending}
      />
      {error && (
        <p className="text-danger-700">{error}</p>
      )}
    </li>
  );
}

function PairSide({
  side,
  payslips,
  suggested,
  onKeep,
  pending,
}: {
  side: { id: string; startDate: string; endDate: string; state: string };
  payslips: number;
  suggested: boolean;
  onKeep: () => void;
  pending: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [employees, setEmployees] = React.useState<
    Awaited<ReturnType<typeof previewPeriodEmployeeSummaryAction>>["rows"] | null
  >(null);
  const [loading, setLoading] = React.useState(false);

  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (employees === null) {
      setLoading(true);
      const r = await previewPeriodEmployeeSummaryAction(side.id);
      setEmployees(r.rows);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          className="text-left flex-1 min-w-0 hover:underline underline-offset-2"
          title="Click to see the per-employee payslip breakdown for this period"
        >
          <code className="font-mono">{side.id.slice(0, 8)}</code>:{" "}
          {side.startDate} → {side.endDate} · {side.state} · {payslips} payslips
          {suggested && (
            <span className="ml-2 rounded-input bg-warning-200 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wider text-warning-900">
              suggested
            </span>
          )}
          <span className="ml-1 text-warning-700">{expanded ? "▼" : "▶"}</span>
        </button>
        <Button
          size="sm"
          variant={suggested ? "default" : "secondary"}
          disabled={pending}
          onClick={onKeep}
        >
          {pending ? "…" : "Keep this · delete other"}
        </Button>
      </div>
      {expanded && (
        <div className="ml-4 rounded-input bg-warning-100 px-2 py-1.5 text-[11px] text-warning-900">
          {loading && <span>Loading…</span>}
          {!loading && employees && employees.length === 0 && (
            <span>No payslips on this period.</span>
          )}
          {!loading && employees && employees.length > 0 && (
            <ul className="space-y-0.5">
              {employees.map((emp) => (
                <li
                  key={emp.employeeId}
                  className={emp.voided ? "line-through opacity-60" : ""}
                >
                  {emp.legacyId ? `#${emp.legacyId} · ` : ""}
                  {emp.displayName} · {emp.hours.toFixed(2)}h · $
                  {(emp.roundedCents / 100).toFixed(2)}
                  {emp.voided && " (voided)"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
