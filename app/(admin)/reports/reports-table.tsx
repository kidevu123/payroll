"use client";

// Reports — "Calm Operations Console" redesign.
//
// Reads like a payroll statement, not a data dump. Structure:
//
//   MONTH GROUP (one soft-shadowed surface card per month)
//     ├─ quiet month subheader  ……  run count + month NET subtotal
//     ├─ period line ── period range · cadence · paid-via · status ── NET ▸
//     │     └─ run sub-line(s)  (only when a period has >1 run)
//     ├─ ─────────── hairline divider ───────────
//     └─ period line …
//
// One soft shadow lives on the month card; rows inside are separated by
// hairline dividers only. A period with a single run collapses its run
// detail into the period line (no redundant nesting); multi-run periods
// expand their runs as indented sub-lines so each run keeps its own
// actions.
//
// Every per-run action is preserved: View (eye) + an overflow menu that
// carries Download PDF, cut sheet, signature report, open admin report,
// publish-to-portal, Zoho push/re-push (Haute + Boomin), and delete.
// Period-level "Pay from cash drawer" and the paid-via chip stay on the
// period line.
//
// Mobile: period lines reflow to two stacked rows (identity on top, the
// NET + actions beneath) with comfortable 40px tap targets and no
// horizontal scroll.

import * as React from "react";
import Link from "next/link";
import {
  Download,
  Eye,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  CheckCircle2,
  CircleDot,
  MoreHorizontal,
  Upload,
  FileText,
  Scissors,
  Banknote,
  Landmark,
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
import { MoneyDisplay } from "@/components/domain/money-display";
import { SchedulePill } from "@/components/domain/schedule-pill";
import { canonicalEndForScheduleName } from "@/lib/payroll/period-boundaries";
import {
  deleteReportAction,
  publishReportAction,
  pushReportToZohoAction,
  repushReportToZohoAction,
} from "./actions";
import { markPaidAction } from "../payroll/actions";

/** Cadence accent rail. A single, quiet brand-tinted edge so the row reads
 *  as part of one cohesive statement — the cadence itself is spelled out by
 *  the SchedulePill, so the rail no longer needs to carry color meaning. */
function cadenceAccent(name: string | null | undefined): string {
  return name ? "bg-brand-700" : "bg-border-strong";
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatRange(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return "—";
  const a = new Date(`${startIso}T12:00:00Z`);
  const b = new Date(`${endIso}T12:00:00Z`);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${MONTH_SHORT[a.getUTCMonth()]} ${String(a.getUTCDate()).padStart(2, "0")}${sameYear ? "" : `, ${a.getUTCFullYear()}`}`;
  const right = `${MONTH_SHORT[b.getUTCMonth()]} ${String(b.getUTCDate()).padStart(2, "0")}, ${b.getUTCFullYear()}`;
  return `${left} – ${right}`;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return `${MONTH_SHORT[dt.getMonth()]} ${String(dt.getDate()).padStart(2, "0")}, ${dt.getFullYear()}`;
}

/** "May 2026" header for the month-cohort card. */
function monthLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return `${MONTH_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function monthKey(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type GroupedReport = {
  periodId: string;
  periodStart: string;
  periodEnd: string;
  scheduleName: string | null;
  tempLaborCents: number;
  docNetPayCents: number;
  runs: ReportRow[];
};

type MonthGroup = {
  key: string;
  label: string;
  periods: GroupedReport[];
};

/** Group runs by periodId while preserving the newest-first ordering of
 *  the input list. Each group keeps the metadata of its first run (which
 *  represents the period). */
function groupByPeriod(reports: ReportRow[]): GroupedReport[] {
  const groups: GroupedReport[] = [];
  const indexById = new Map<string, number>();
  for (const r of reports) {
    let idx = indexById.get(r.periodId);
    if (idx === undefined) {
      idx = groups.length;
      indexById.set(r.periodId, idx);
      groups.push({
        periodId: r.periodId,
        periodStart: r.startDate,
        periodEnd: r.endDate,
        scheduleName: r.scheduleName,
        tempLaborCents: r.tempLaborCents,
        docNetPayCents: r.docNetPayCents,
        runs: [],
      });
    }
    const group = groups[idx];
    if (group) group.runs.push(r);
  }
  return groups;
}

/** Roll periods up into month cohorts, preserving newest-first order. */
function groupByMonth(periods: GroupedReport[]): MonthGroup[] {
  const months: MonthGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const p of periods) {
    const mk = monthKey(p.periodStart);
    let idx = indexByKey.get(mk);
    if (idx === undefined) {
      idx = months.length;
      indexByKey.set(mk, idx);
      months.push({ key: mk, label: monthLabel(p.periodStart), periods: [] });
    }
    const month = months[idx];
    if (month) month.periods.push(p);
  }
  return months;
}

/** Period NET = run amounts + temp labor + salaried/W2 paystub net (each
 *  counted once). Salaried payouts are real payroll, so they belong in the
 *  period + month total — not just a side note. */
function periodNet(g: GroupedReport): number {
  let total = 0;
  for (const r of g.runs) total += r.amountCents;
  return total + g.tempLaborCents + g.docNetPayCents;
}

/** Period GROSS = sum of run gross + temp labor (temp counted once). */
function periodGross(g: GroupedReport): number {
  let total = 0;
  for (const r of g.runs) total += r.grossPayCents;
  return total + g.tempLaborCents;
}

/** Month NET subtotal across its periods, from already-fetched rows. */
function monthNet(m: MonthGroup): number {
  let total = 0;
  for (const p of m.periods) total += periodNet(p);
  return total;
}

export function ReportsTable({
  reports,
  zohoOrgs,
  drawerBalanceCents = 0,
  canManageReports = true,
}: {
  reports: ReportRow[];
  zohoOrgs: ZohoOrganization[];
  /** Current cash-on-hand. Drives the "Pay from cash drawer" dialog
   *  so the operator sees what's available before confirming. */
  drawerBalanceCents?: number;
  canManageReports?: boolean;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const haute = zohoOrgs.find((o) => /haute/i.test(o.name));
  const boomin = zohoOrgs.find((o) => /boomin/i.test(o.name));

  async function onPush(reportId: string, orgId: string | undefined, orgLabel: string) {
    if (!orgId) {
      setError(`Connect "${orgLabel}" in /settings/zoho first.`);
      return;
    }
    setBusyId(`${reportId}:push:${orgId}`);
    setError(null);
    const result = await pushReportToZohoAction(reportId, orgId);
    setBusyId(null);
    if (result?.error) setError(result.error);
  }

  async function onRepush(
    reportId: string,
    orgId: string | undefined,
    orgLabel: string,
    expenseId: string | null,
  ) {
    if (!orgId) {
      setError(`Connect "${orgLabel}" in /settings/zoho first.`);
      return;
    }
    const ok = window.confirm(
      `Re-push to ${orgLabel}?\n\nThis will DELETE the existing expense ${expenseId ?? "(unknown id)"} in Zoho and create a fresh one with the current period total. Use this after a fix changes what should be charged.\n\nThe accountant will see the old expense disappear.`,
    );
    if (!ok) return;
    setBusyId(`${reportId}:push:${orgId}`);
    setError(null);
    const result = await repushReportToZohoAction(reportId, orgId);
    setBusyId(null);
    if ("error" in result && result.error) {
      const isDeleteFailure = result.error.includes("Could not delete prior");
      if (isDeleteFailure) {
        const force = window.confirm(
          `${result.error}\n\nForce re-push? This SKIPS the Zoho delete and just posts a fresh expense. Use this if you've already deleted the old expense in Zoho manually, OR if your Zoho OAuth scope can't DELETE.\n\nIf you click OK and the old expense is still in Zoho, you'll have BOTH expenses (you'll need to delete the old one yourself later).`,
        );
        if (force) {
          setBusyId(`${reportId}:push:${orgId}`);
          setError(null);
          const forced = await repushReportToZohoAction(reportId, orgId, {
            force: true,
          });
          setBusyId(null);
          if ("error" in forced && forced.error) setError(forced.error);
        } else {
          setError(result.error);
        }
      } else {
        setError(result.error);
      }
    }
  }

  async function onDelete(id: string) {
    setBusyId(`${id}:delete`);
    setError(null);
    const result = await deleteReportAction(id);
    setBusyId(null);
    setConfirmDelete(null);
    if (result?.error) setError(result.error);
  }

  async function onPublish(id: string) {
    setBusyId(`${id}:publish`);
    setError(null);
    const result = await publishReportAction(id);
    setBusyId(null);
    if (result?.error) setError(result.error);
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-card border border-border/70 bg-surface p-10 text-center text-sm text-text-muted shadow-card">
        No payroll runs yet. They appear here once a run completes (cron, manual
        upload, or legacy import).
      </div>
    );
  }

  const months = groupByMonth(groupByPeriod(reports));

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-card border border-danger-200/80 bg-danger-50 px-4 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      {months.map((m) => (
        <MonthCard
          key={m.key}
          month={m}
          busyId={busyId}
          setError={setError}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          onPush={onPush}
          onRepush={onRepush}
          onPublish={onPublish}
          onDelete={onDelete}
          haute={haute}
          boomin={boomin}
          drawerBalanceCents={drawerBalanceCents}
          canManageReports={canManageReports}
        />
      ))}
    </div>
  );
}

type SharedHandlers = {
  busyId: string | null;
  setError: (v: string | null) => void;
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
  drawerBalanceCents: number;
  canManageReports: boolean;
};

function MonthCard({
  month,
  ...handlers
}: { month: MonthGroup } & SharedHandlers) {
  const net = monthNet(month);
  const runCount = month.periods.reduce((n, p) => n + p.runs.length, 0);

  return (
    <section
      aria-label={month.label}
      className="overflow-hidden rounded-card border border-border/70 bg-surface shadow-card transition-shadow hover:shadow-card-strong"
    >
      {/* Refined month header: an accent tick + confident month label on the
          left, the month NET subtotal as the right-anchored figure. The NET
          label is whispered (uppercase micro) so the number does the talking. */}
      <header className="flex items-center justify-between gap-3 border-b border-border/70 bg-surface-2/50 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            aria-hidden="true"
            className="h-4 w-1 shrink-0 rounded-full bg-brand-700"
          />
          <h2 className="text-sm font-semibold tracking-tight text-text">
            {month.label}
          </h2>
          <span className="rounded-chip bg-surface-3 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-text-muted">
            {month.periods.length}{" "}
            {month.periods.length === 1 ? "period" : "periods"}
            {runCount !== month.periods.length && (
              <>
                {" · "}
                {runCount} {runCount === 1 ? "run" : "runs"}
              </>
            )}
          </span>
        </div>
        <div className="flex flex-col items-end leading-none whitespace-nowrap">
          <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-text-subtle">
            Month net
          </span>
          <span className="mt-1 font-mono tabular-nums text-base font-semibold text-text">
            <MoneyDisplay cents={net} />
          </span>
        </div>
      </header>

      {/* Period statement lines, hairline-separated */}
      <div className="divide-y divide-border/60">
        {month.periods.map((p) => (
          <PeriodLine key={p.periodId} group={p} {...handlers} />
        ))}
      </div>
    </section>
  );
}

function PeriodLine({
  group,
  busyId,
  setError,
  confirmDelete,
  setConfirmDelete,
  onPush,
  onRepush,
  onPublish,
  onDelete,
  haute,
  boomin,
  drawerBalanceCents,
  canManageReports,
}: { group: GroupedReport } & SharedHandlers) {
  const net = periodNet(group);
  const gross = periodGross(group);
  const accent = cadenceAccent(group.scheduleName);
  const canonicalEnd = canonicalEndForScheduleName(
    group.periodStart,
    group.periodEnd,
    group.scheduleName,
  );
  // All runs in a group share the same period — read state from the
  // first run. Used to switch between "Pay from cash drawer" (LOCKED)
  // and the static paid-via pill (PAID).
  const periodState = group.runs[0]?.periodState ?? "OPEN";
  const periodPaymentMethod = group.runs[0]?.periodPaymentMethod ?? null;
  const multiRun = group.runs.length > 1;
  const soleRun = group.runs.length === 1 ? group.runs[0] : undefined;

  const [payOpen, setPayOpen] = React.useState(false);
  const [payAmount, setPayAmount] = React.useState(() => (net / 100).toFixed(2));
  const [paying, setPaying] = React.useState(false);

  async function payFromDrawer() {
    setPaying(true);
    setError(null);
    const cents = Math.round(Number(payAmount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setPaying(false);
      setError("Enter a positive amount.");
      return;
    }
    if (cents > drawerBalanceCents) {
      setPaying(false);
      setError(
        `Drawer has $${(drawerBalanceCents / 100).toFixed(2)} on hand — short by $${((cents - drawerBalanceCents) / 100).toFixed(2)}.`,
      );
      return;
    }
    const fd = new FormData();
    fd.set("paymentMethod", "CASH");
    fd.set("cashAmountCents", cents.toString());
    const r = await markPaidAction(group.periodId, fd);
    setPaying(false);
    if (r?.error) setError(r.error);
    else setPayOpen(false);
  }

  // Salaried W2 paystub period — a simple statement line (no payroll-run
  // actions; the documents themselves are managed on the Salaried page).
  const paystubRun = group.runs.find((r) => r.isSalariedPaystub);
  if (paystubRun) {
    const docs = paystubRun.paystubDocs ?? [];
    return (
      <div className="group/row relative transition-colors hover:bg-surface-2/40">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px] bg-brand-700 opacity-70 transition-opacity group-hover/row:opacity-100"
        />
        <div className="py-3 pl-4 pr-4 sm:pl-5 sm:pr-5">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
              <Link
                href="/salaried"
                className="rounded-input font-mono text-sm font-semibold tracking-tight text-text tabular-nums whitespace-nowrap transition-colors hover:text-brand-700"
              >
                {formatRange(group.periodStart, group.periodEnd)}
              </Link>
              <span className="flex flex-wrap items-center gap-1.5">
                <SchedulePill name="Salaried" />
                <span className="inline-flex items-center gap-1 rounded-chip border border-info-100 bg-info-50 px-2 py-0.5 text-[10px] font-medium text-info-800">
                  <FileText className="h-3 w-3" /> {docs.length}{" "}
                  {docs.length === 1 ? "paystub" : "paystubs"}
                </span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <div className="flex flex-col items-start leading-none sm:items-end">
                <span className="font-mono tabular-nums text-xl font-semibold tracking-tight text-text">
                  <MoneyDisplay cents={net} />
                </span>
                <span className="mt-1 font-mono text-[10px] leading-tight tabular-nums text-text-subtle">
                  W2 net · uploaded paystubs
                </span>
              </div>
              <Button asChild size="sm" variant="ghost" title="Manage paystubs">
                <Link href="/salaried">
                  <Eye className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/row relative transition-colors hover:bg-surface-2/40">
      {/* Cadence accent rail — a thin colored edge so weekly / semi-monthly /
          monthly read at a glance without parsing the pill. Brightens on hover. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-[3px] ${accent} opacity-70 transition-opacity group-hover/row:opacity-100`}
      />

      <div className="py-3 pl-4 pr-4 sm:pl-5 sm:pr-5">
        {/* Statement line — stacks on mobile, one aligned row on >=sm. The
            left identity column and the NET hero share a single baseline grid
            so chips sit centered, never floating after the date. */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-5">
          {/* Left identity column: period range, then chips on a consistent
              centered baseline. min-w-0 lets it truncate before the NET. */}
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            <Link
              href={`/payroll/${group.periodId}`}
              className="rounded-input font-mono text-sm font-semibold tracking-tight text-text tabular-nums whitespace-nowrap transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40"
            >
              {formatRange(group.periodStart, canonicalEnd)}
            </Link>
            <span className="flex flex-wrap items-center gap-1.5">
              <SchedulePill name={group.scheduleName} />
              <PaymentChip state={periodState} method={periodPaymentMethod} />
              {!multiRun && soleRun && (
                <VisibilityChip published={soleRun.publishedToPortalAt !== null} />
              )}
            </span>
          </div>

          {/* Right: NET hero + trailing actions. NET is the number that gets
              paid — large, bold, tabular. Gross + addenda are demoted to a
              tiny muted line below, clearly subordinate. */}
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <div className="flex flex-col items-start leading-none sm:items-end">
              <span className="font-mono tabular-nums text-xl font-semibold tracking-tight text-text">
                <MoneyDisplay cents={net} />
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0 font-mono text-[10px] leading-tight tabular-nums">
                {gross > 0 && gross !== net && (
                  <span className="text-text-subtle">
                    gross <MoneyDisplay cents={gross} monospace={false} />
                  </span>
                )}
                {group.docNetPayCents > 0 && (
                  <span className="text-success-700">
                    incl. <MoneyDisplay cents={group.docNetPayCents} monospace={false} /> W2 net
                  </span>
                )}
                {group.tempLaborCents > 0 && (
                  <span className="text-text-subtle">
                    incl. <MoneyDisplay cents={group.tempLaborCents} monospace={false} /> temp
                  </span>
                )}
              </span>
            </div>

            {/* Pay-from-drawer trigger (period-level, LOCKED only) */}
            {canManageReports && periodState === "LOCKED" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPayOpen((v) => !v)}
                className="h-9 px-2.5 text-[11px] whitespace-nowrap"
                title={`Drawer: $${(drawerBalanceCents / 100).toFixed(2)} on hand`}
              >
                <Banknote className="h-3.5 w-3.5" /> Pay
              </Button>
            )}

            {/* Single-run period: actions live here on the period line */}
            {!multiRun && soleRun && (
              <RunActions
                run={soleRun}
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
            )}
          </div>
        </div>

      {/* Pay-from-drawer dialog (inline, period-level) */}
      {canManageReports && payOpen && periodState === "LOCKED" && (
        <div className="mt-3 rounded-input border border-warn-200/70 bg-warn-50/50 px-3 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-text-subtle">
                Drawer balance
              </p>
              <p className="font-mono tabular-nums text-sm font-semibold">
                <MoneyDisplay cents={drawerBalanceCents} />
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-text-subtle">
                Withdraw
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                disabled={paying}
                className="block h-9 w-32 rounded-input border border-border/70 bg-surface px-2.5 text-sm tabular-nums"
              />
            </div>
            <Button size="sm" onClick={payFromDrawer} disabled={paying} className="h-9">
              <Banknote className="h-4 w-4" />
              {paying ? "Paying…" : "Pay this period from drawer"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPayOpen(false)}
              disabled={paying}
              className="h-9"
            >
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            Marks the period <span className="font-semibold">PAID</span>, records
            a withdrawal on the cash drawer ledger, and links the two so the
            drawer entry references this period.
          </p>
        </div>
      )}

      {/* Multi-run period: expand each run as an indented sub-line so every
          run keeps its own visibility chip, amount, and actions. */}
      {multiRun && (
        <ul className="mt-2.5 space-y-px border-l border-border/60 pl-3 sm:ml-1">
          {group.runs.map((r) => (
            <li
              key={r.id}
              className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:gap-3"
            >
              <Link
                href={`/payroll/${r.periodId}`}
                className="flex min-w-0 flex-1 items-baseline gap-1.5 hover:text-brand-700"
              >
                <span className="text-[10px] uppercase tracking-wider text-text-subtle">
                  {r.source.replace(/_/g, " ")}
                </span>
                <span className="text-text-subtle">·</span>
                <span className="font-mono text-xs tabular-nums text-text-muted">
                  {r.id.slice(0, 8)}
                </span>
                <span className="truncate text-[11px] text-text-muted">
                  {r.createdByDisplay} ·{" "}
                  <span className="font-mono tabular-nums">{formatDate(r.postedAt)}</span>
                </span>
              </Link>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <ZohoBadges run={r} haute={haute} boomin={boomin} />
                <VisibilityChip published={r.publishedToPortalAt !== null} />
                <span className="min-w-[5rem] text-right font-mono tabular-nums text-sm font-semibold text-text">
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
      )}
      </div>
    </div>
  );
}

/** Period payment-method chip (PAID) — bank / drawer / generic. */
function PaymentChip({
  state,
  method,
}: {
  state: "OPEN" | "LOCKED" | "PAID";
  method: "BANK" | "CASH" | null;
}) {
  if (state !== "PAID") return null;
  if (method === "CASH") {
    return (
      <span className="inline-flex items-center gap-1 rounded-chip border border-warn-200 bg-warn-50 px-2 py-0.5 text-[10px] font-medium text-warn-800">
        <Banknote className="h-3 w-3" /> Paid from drawer
      </span>
    );
  }
  if (method === "BANK") {
    return (
      <span className="inline-flex items-center gap-1 rounded-chip border border-info-100 bg-info-50 px-2 py-0.5 text-[10px] font-medium text-info-800">
        <Landmark className="h-3 w-3" /> Paid via bank
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-info-100 bg-info-50 px-2 py-0.5 text-[10px] font-medium text-info-800">
      <Landmark className="h-3 w-3" /> Paid from bank account
    </span>
  );
}

/** Portal visibility chip (per run). */
function VisibilityChip({ published }: { published: boolean }) {
  return published ? (
    <span className="inline-flex items-center gap-1 rounded-chip bg-success-50 px-1.5 py-0.5 text-[10px] font-medium text-success-800 ring-1 ring-inset ring-success-100 whitespace-nowrap">
      <CheckCircle2 className="h-2.5 w-2.5" /> Published
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-chip bg-warn-50 px-1.5 py-0.5 text-[10px] font-medium text-warn-800 ring-1 ring-inset ring-warn-200 whitespace-nowrap">
      <CircleDot className="h-2.5 w-2.5" /> Internal
    </span>
  );
}

/** Read-only Zoho push summary badges (mutate via the overflow menu). */
function ZohoBadges({
  run,
  haute,
  boomin,
}: {
  run: ReportRow;
  haute: ZohoOrganization | undefined;
  boomin: ZohoOrganization | undefined;
}) {
  const pushedHaute = run.zohoPushes.find((p) => p.orgId === haute?.id);
  const pushedBoomin = run.zohoPushes.find((p) => p.orgId === boomin?.id);
  if (!pushedHaute && !pushedBoomin) return null;
  return (
    <div className="flex items-center gap-1.5">
      {pushedHaute && (
        <span
          className="inline-flex items-center gap-1 rounded-chip bg-success-50 px-1.5 py-0.5 text-[10px] font-medium text-success-800 ring-1 ring-inset ring-success-100"
          title={`Haute · expense ${pushedHaute.expenseId ?? "—"}`}
        >
          <CheckCircle2 className="h-2.5 w-2.5" /> Haute
        </span>
      )}
      {pushedBoomin && (
        <span
          className="inline-flex items-center gap-1 rounded-chip bg-success-50 px-1.5 py-0.5 text-[10px] font-medium text-success-800 ring-1 ring-inset ring-success-100"
          title={`Boomin · expense ${pushedBoomin.expenseId ?? "—"}`}
        >
          <CheckCircle2 className="h-2.5 w-2.5" /> Boomin
        </span>
      )}
    </div>
  );
}

/** Trailing affordance for a single run: View + overflow menu. Inline
 *  delete-confirm replaces the menu trigger while pending. */
function RunActions({
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
        className="h-9 w-9 p-0"
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

function RowOverflowMenu({
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
        <Button size="sm" variant="ghost" className="h-9 w-9 p-0" title="More actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>Documents</DropdownMenuLabel>
        {hasPdf ? (
          <DropdownMenuItem asChild>
            <Link href={`/api/reports/${runId}/pdf`} target="_blank" rel="noopener">
              <Download className="h-3.5 w-3.5" /> Download report PDF
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <Download className="h-3.5 w-3.5 opacity-40" /> No report PDF
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link
            href={`/api/payroll/${periodId}/payslips-cut-sheet`}
            target="_blank"
            rel="noopener"
          >
            <Scissors className="h-3.5 w-3.5" /> Pay-slip cut sheet
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href={`/api/payslips/period/${periodId}/signature`}
            target="_blank"
            rel="noopener"
          >
            <Printer className="h-3.5 w-3.5" /> Signature report
          </Link>
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
