"use client";

// Reports table — premium redesign.
//
// Layout: each pay PERIOD is a self-contained "card row" with a left-edge
// accent matching the schedule's color (blue=weekly, purple=semi-monthly,
// teal=biweekly, amber=monthly). Inside the card sits the period summary
// header and one or more run rows beneath it, separated by hairline
// dividers. Months are visually segregated by a thin label divider —
// just enough to chunk a long historical list into scannable groups.
//
// Per-row controls: View (eye, primary quick action) + Download PDF stay
// outside as icon buttons. Everything else (signature print, publish,
// Haute push, Boomin push, delete) lives behind a single MoreHorizontal
// overflow menu so the row stays calm even when 7 actions are wired up.

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

/**
 * Map a schedule name to a left-border accent color + soft tint for the
 * period summary row. Mirrors `SchedulePill` so a period's chip and the
 * row's accent agree at a glance.
 */
function scheduleAccent(name: string | null | undefined): {
  border: string;
  tint: string;
} {
  const n = (name ?? "").toLowerCase();
  if (n.includes("semi")) {
    return { border: "border-l-purple-500", tint: "bg-purple-50/40" };
  }
  if (n.includes("bi") || n.includes("two-week")) {
    return { border: "border-l-teal-500", tint: "bg-teal-50/40" };
  }
  if (n.includes("month") && !n.includes("semi")) {
    return { border: "border-l-amber-500", tint: "bg-amber-50/40" };
  }
  if (n.includes("week")) {
    return { border: "border-l-blue-500", tint: "bg-blue-50/40" };
  }
  return { border: "border-l-border-strong", tint: "bg-surface-2/50" };
}

/** "May 2026" header for the month-cohort divider. */
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

function sumGroupTotal(g: GroupedReport): number {
  let total = 0;
  for (const r of g.runs) total += r.amountCents;
  return total + g.tempLaborCents;
}

function sumGroupGross(g: GroupedReport): number {
  let total = 0;
  for (const r of g.runs) total += r.grossPayCents;
  return total + g.tempLaborCents;
}

export function ReportsTable({
  reports,
  zohoOrgs,
  drawerBalanceCents = 0,
}: {
  reports: ReportRow[];
  zohoOrgs: ZohoOrganization[];
  /** Current cash-on-hand. Drives the "Pay from cash drawer" dialog
   *  so the operator sees what's available before confirming. */
  drawerBalanceCents?: number;
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

  const groups = groupByPeriod(reports);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-card border border-danger-200/80 bg-danger-50 px-4 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      {(() => {
        // Render groups, injecting a month divider whenever the month
        // changes. The divider is keyed by month so React reconciles
        // cleanly when the filter changes.
        const out: React.ReactNode[] = [];
        let lastMonth: string | null = null;
        for (const g of groups) {
          const mk = monthKey(g.periodStart);
          if (mk && mk !== lastMonth) {
            out.push(
              <div
                key={`m:${mk}`}
                className="flex items-center gap-3 pt-2 pb-1 first:pt-0"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-subtle">
                  {monthLabel(g.periodStart)}
                </span>
                <span className="h-px flex-1 bg-border/70" />
              </div>,
            );
            lastMonth = mk;
          }
          out.push(
            <PeriodGroup
              key={g.periodId}
              group={g}
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
            />,
          );
        }
        return out;
      })()}
    </div>
  );
}

function PeriodGroup({
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
}: {
  group: GroupedReport;
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
}) {
  const accent = scheduleAccent(group.scheduleName);
  const periodTotal = sumGroupTotal(group);
  const periodGross = sumGroupGross(group);
  const canonicalEnd = canonicalEndForScheduleName(
    group.periodStart,
    group.periodEnd,
    group.scheduleName,
  );
  // All runs in a group share the same period — read state from the
  // first run. Used to switch between "Pay from cash drawer" (LOCKED)
  // and the static "Paid bank/cash" pill (PAID).
  const periodState = group.runs[0]?.periodState ?? "OPEN";
  const periodPaymentMethod = group.runs[0]?.periodPaymentMethod ?? null;
  const [payOpen, setPayOpen] = React.useState(false);
  const [payAmount, setPayAmount] = React.useState(
    () => (periodTotal / 100).toFixed(2),
  );
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

  return (
    <div
      className={`rounded-card border border-border/70 bg-surface shadow-card overflow-hidden border-l-[3px] ${accent.border}`}
    >
      {/* Period summary row */}
      <div className={`flex items-center justify-between gap-4 px-4 py-3 ${accent.tint}`}>
        <div className="flex items-baseline gap-3 flex-wrap min-w-0">
          <span className="font-semibold tracking-tight text-base text-text whitespace-nowrap">
            {formatRange(group.periodStart, canonicalEnd)}
          </span>
          <SchedulePill name={group.scheduleName} />
          <span className="text-[10px] uppercase tracking-wider text-text-subtle">
            Period total
          </span>
          {periodState === "PAID" && periodPaymentMethod === "CASH" && (
            <span className="inline-flex items-center gap-1 rounded-chip border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
              <Banknote className="h-3 w-3" /> Paid from drawer
            </span>
          )}
          {periodState === "PAID" && periodPaymentMethod === "BANK" && (
            <span className="inline-flex items-center gap-1 rounded-chip border border-info-200 bg-info-50 px-2 py-0.5 text-[10px] font-medium text-info-800">
              <Landmark className="h-3 w-3" /> Paid via bank
            </span>
          )}
          {periodState === "PAID" && periodPaymentMethod === null && (
            <span className="inline-flex items-center gap-1 rounded-chip border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
              <CheckCircle2 className="h-3 w-3" /> Paid
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-right whitespace-nowrap">
          {periodState === "LOCKED" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPayOpen((v) => !v)}
              className="h-7 px-2.5 text-[11px]"
              title={`Drawer: $${(drawerBalanceCents / 100).toFixed(2)} on hand`}
            >
              <Banknote className="h-3.5 w-3.5" /> Pay from drawer
            </Button>
          )}
          <div className="flex flex-col items-end gap-0">
            <span className="font-mono tabular-nums font-semibold text-text">
              <MoneyDisplay cents={periodTotal} />
            </span>
            {periodGross > 0 && periodGross !== periodTotal && (
              <span className="text-[10px] text-text-muted tabular-nums font-mono">
                gross <MoneyDisplay cents={periodGross} monospace={false} />
              </span>
            )}
            {group.docNetPayCents > 0 && (
              <span className="text-[10px] text-emerald-700 tabular-nums font-mono">
                +<MoneyDisplay cents={group.docNetPayCents} monospace={false} /> W2 net
              </span>
            )}
            {group.tempLaborCents > 0 && (
              <span className="text-[10px] text-text-muted">
                incl. <MoneyDisplay cents={group.tempLaborCents} monospace={false} /> temp
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Pay-from-drawer dialog. Inline (not a modal) to keep the page
          flow obvious — you see the period total, the drawer balance,
          and one click commits the cash withdrawal + period mark-paid
          in the same transaction. */}
      {payOpen && periodState === "LOCKED" && (
        <div className="px-4 py-3 border-t border-border/60 bg-amber-50/40">
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
            <Button
              size="sm"
              onClick={payFromDrawer}
              disabled={paying}
              className="h-9"
            >
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
          <p className="text-[11px] text-text-muted mt-2 leading-relaxed">
            Marks the period <span className="font-semibold">PAID</span>,
            records a withdrawal on the cash drawer ledger, and links the
            two so the drawer entry references this period.
          </p>
        </div>
      )}

      {/* Run rows */}
      <div className="divide-y divide-border/60">
        {group.runs.map((r) => {
          const pushedHaute = r.zohoPushes.find((p) => p.orgId === haute?.id);
          const pushedBoomin = r.zohoPushes.find((p) => p.orgId === boomin?.id);
          const published = r.publishedToPortalAt !== null;
          const isLegacy = r.source === "LEGACY_IMPORT";

          return (
            <div
              key={r.id}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/50 transition-colors"
            >
              {/* Run identity (source + short id) */}
              <Link
                href={`/payroll/${r.periodId}`}
                className="flex items-baseline gap-1.5 min-w-0 hover:text-brand-700 transition-colors"
              >
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                  {r.source.replace(/_/g, " ")}
                </span>
                <span className="text-text-subtle">·</span>
                <span className="font-mono text-xs text-text">{r.id.slice(0, 8)}</span>
              </Link>

              {/* Created by */}
              <span className="text-xs text-text-muted truncate max-w-[10rem]">
                {r.createdByDisplay}
              </span>

              {/* Posted */}
              <span className="text-xs text-text-muted whitespace-nowrap">
                {formatDate(r.postedAt)}
              </span>

              {/* Push status badges (read-only summary; mutate via menu) */}
              <div className="flex items-center gap-1.5">
                {pushedHaute && (
                  <span
                    className="inline-flex items-center gap-1 rounded-chip bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                    title={`Haute · expense ${pushedHaute.expenseId ?? "—"}`}
                  >
                    <CheckCircle2 className="h-2.5 w-2.5" /> Haute
                  </span>
                )}
                {pushedBoomin && (
                  <span
                    className="inline-flex items-center gap-1 rounded-chip bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                    title={`Boomin · expense ${pushedBoomin.expenseId ?? "—"}`}
                  >
                    <CheckCircle2 className="h-2.5 w-2.5" /> Boomin
                  </span>
                )}
              </div>

              <span className="flex-1" />

              {/* Visibility chip */}
              {published ? (
                <span className="inline-flex items-center gap-1 rounded-chip bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 whitespace-nowrap">
                  <CheckCircle2 className="h-2.5 w-2.5" /> Published
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-chip bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200 whitespace-nowrap">
                  <CircleDot className="h-2.5 w-2.5" /> Internal
                </span>
              )}

              {/* Run amount */}
              <div className="text-right whitespace-nowrap min-w-[5.5rem]">
                <div className="font-mono tabular-nums font-semibold text-sm text-text">
                  <MoneyDisplay cents={r.amountCents} />
                </div>
                {r.tempLaborCents > 0 && (
                  <div className="text-[10px] font-normal text-text-muted">
                    + <MoneyDisplay cents={r.tempLaborCents} monospace={false} /> temp
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="flex items-center gap-0.5 ml-1">
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  title="Open admin report"
                >
                  <Link href={`/payroll/${r.periodId}`}>
                    <Eye className="h-4 w-4" />
                  </Link>
                </Button>
                {r.pdfPath ? (
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    title="Download report PDF"
                  >
                    <Link
                      href={`/api/reports/${r.id}/pdf`}
                      target="_blank"
                      rel="noopener"
                    >
                      <Download className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    disabled
                    title="No PDF"
                  >
                    <Download className="h-4 w-4 opacity-30" />
                  </Button>
                )}

                {confirmDelete === r.id ? (
                  <span className="inline-flex items-center gap-0.5 rounded-input border border-danger-200/80 bg-danger-50 pl-2">
                    <span className="text-[11px] font-medium text-danger-700">
                      Delete?
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] text-danger-700 hover:bg-danger-100"
                      disabled={busyId === `${r.id}:delete`}
                      onClick={() => onDelete(r.id)}
                    >
                      {busyId === `${r.id}:delete` ? "…" : "Confirm"}
                    </Button>
                  </span>
                ) : (
                  <RowOverflowMenu
                    runId={r.id}
                    periodId={r.periodId}
                    published={published}
                    isLegacy={isLegacy}
                    busyId={busyId}
                    pushedHaute={pushedHaute}
                    pushedBoomin={pushedBoomin}
                    hauteOrgId={haute?.id}
                    boominOrgId={boomin?.id}
                    onPublish={() => onPublish(r.id)}
                    onPushHaute={() => onPush(r.id, haute?.id, "Haute")}
                    onPushBoomin={() => onPush(r.id, boomin?.id, "Boomin")}
                    onRepushHaute={() =>
                      onRepush(
                        r.id,
                        haute?.id,
                        "Haute",
                        pushedHaute?.expenseId ?? null,
                      )
                    }
                    onRepushBoomin={() =>
                      onRepush(
                        r.id,
                        boomin?.id,
                        "Boomin",
                        pushedBoomin?.expenseId ?? null,
                      )
                    }
                    onDeleteRequest={() => setConfirmDelete(r.id)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RowOverflowMenu({
  runId,
  periodId,
  published,
  isLegacy,
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
}: {
  runId: string;
  periodId: string;
  published: boolean;
  isLegacy: boolean;
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
}) {
  const publishBusy = busyId === `${runId}:publish`;
  const hauteBusy = busyId === `${runId}:push:${hauteOrgId ?? ""}`;
  const boominBusy = busyId === `${runId}:push:${boominOrgId ?? ""}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          title="More actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel>Documents</DropdownMenuLabel>
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

        {!published && !isLegacy && (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
