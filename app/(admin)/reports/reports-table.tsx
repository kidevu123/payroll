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
import { useRouter } from "next/navigation";
import { PdfLink } from "@/components/domain/pdf-link";
import { periodNetCents } from "@/lib/reports/period-net";
import { formatPeriodRange as formatRange } from "@/lib/payroll/format-period";
import { cn } from "@/lib/utils";
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
  Lock,
  Search,
  X,
} from "lucide-react";
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import type { ZohoOrganization } from "@/lib/db/schema";
import { Button, IconButton } from "@/components/ui/button";
import { MicroLabel } from "@/components/ui/typography";
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
import {
  STATUS_CHIP_BASE,
  statusChipClasses,
  type StatusTone,
} from "@/components/domain/status-pill";
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
  replacedRunNetCents: number;
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
        replacedRunNetCents: r.replacedRunNetCents,
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

/** Period NET = the actual take-home paid.
 *
 *  For salaried/W2 employees the run computes pay UNTAXED (≈ gross), but the
 *  uploaded W2 paystub carries the real net. So we SWAP: subtract the run net
 *  of employees who have a paystub (replacedRunNetCents) and add the paystub
 *  net (docNetPayCents). Hourly employees (no paystub) keep their run net, so a
 *  mixed period stays correct. No double-count, and net never exceeds gross. */
function periodNet(g: GroupedReport): number {
  let total = 0;
  for (const r of g.runs) total += r.amountCents;
  return periodNetCents({
    runTotalCents: total,
    replacedRunNetCents: g.replacedRunNetCents,
    docNetPayCents: g.docNetPayCents,
    tempLaborCents: g.tempLaborCents,
  });
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

/** Month GROSS subtotal across its periods. */
function monthGross(m: MonthGroup): number {
  let total = 0;
  for (const p of m.periods) total += periodGross(p);
  return total;
}

// ── Filter bar state ─────────────────────────────────────────────────────
// Everything below the schedule select is client-side over rows already in
// memory — instant, no server round trip. Schedule navigates (?schedule=)
// because the server merges salaried paystubs per tab.

type StatusFilter = "all" | "PAID" | "LOCKED" | "OPEN";
type MethodFilter = "all" | "BANK" | "CASH";
type SortKey = "newest" | "oldest" | "net-desc" | "net-asc";

function groupState(g: GroupedReport): "OPEN" | "LOCKED" | "PAID" {
  const s = g.runs[0]?.periodState;
  if (s === "LOCKED" || s === "PAID") return s;
  // Salaried paystub groups have no run state — an uploaded paystub is a
  // paid document, so they bucket under PAID.
  if (g.runs.some((r) => r.isSalariedPaystub)) return "PAID";
  return "OPEN";
}

function groupMethod(g: GroupedReport): MethodFilter | null {
  // Salaried W2 paystubs are paid out via bank transfer (owner directive),
  // unless their period explicitly recorded a cash-drawer payment.
  if (g.runs.some((r) => r.isSalariedPaystub)) {
    return g.runs[0]?.periodPaymentMethod === "CASH" ? "CASH" : "BANK";
  }
  if (groupState(g) !== "PAID") return null;
  return g.runs[0]?.periodPaymentMethod === "CASH" ? "CASH" : "BANK";
}

function matchesFilters(
  g: GroupedReport,
  q: string,
  status: StatusFilter,
  method: MethodFilter,
): boolean {
  if (status !== "all" && groupState(g) !== status) return false;
  if (method !== "all" && groupMethod(g) !== method) return false;
  if (q) {
    const hay = `${formatRange(g.periodStart, g.periodEnd)} ${g.scheduleName ?? "salaried"}`.toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}

/** Shared lg column template — the header row, every period line, and the
 *  month subtotal row use the exact same tracks so the statement reads as one
 *  aligned table: period | schedule | payment | status | gross | net | actions.
 *
 *  The actions track is a FIXED width, not `auto`. Each row is its own grid
 *  container (there is no subgrid here), so an `auto` track resolved against
 *  each row's own content: 72px in the header, ~74px in a plain row, ~135px
 *  when a LOCKED row added its "Pay" button, ~180px mid delete-confirm. Every
 *  one of those redistributed the remaining six fr tracks differently, so the
 *  header lined up with nothing and rows didn't line up with each other. A
 *  fixed track makes all containers resolve identically. */
const ACTIONS_TRACK = "7.5rem";
const TABLE_GRID =
  "lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_minmax(0,0.75fr)_minmax(0,0.85fr)_7.5rem]";

export function ReportsTable({
  reports,
  zohoOrgs,
  drawerBalanceCents = 0,
  canManageReports = true,
  scheduleTab = "all",
}: {
  reports: ReportRow[];
  zohoOrgs: ZohoOrganization[];
  /** Current cash-on-hand. Drives the "Pay from cash drawer" dialog
   *  so the operator sees what's available before confirming. */
  drawerBalanceCents?: number;
  canManageReports?: boolean;
  /** Active ?schedule= tab — drives the schedule select in the filter bar. */
  scheduleTab?: string;
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [method, setMethod] = React.useState<MethodFilter>("all");
  const [sort, setSort] = React.useState<SortKey>("newest");

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

  const hasActiveFilters =
    query !== "" || status !== "all" || method !== "all" || sort !== "newest";

  // Filter periods, then sort. Newest/oldest reorder the whole statement;
  // net sorts keep the month cohorts but rank periods inside each month.
  const filtered = groupByPeriod(reports).filter((g) =>
    matchesFilters(g, query, status, method),
  );
  const ordered =
    sort === "oldest" ? [...filtered].reverse() : filtered;
  const months = groupByMonth(ordered);
  if (sort === "net-desc" || sort === "net-asc") {
    for (const m of months) {
      m.periods.sort((a, b) =>
        sort === "net-desc"
          ? periodNet(b) - periodNet(a)
          : periodNet(a) - periodNet(b),
      );
    }
  }

  return (
    <div className="space-y-4">
      <FilterBar
        scheduleTab={scheduleTab}
        query={query}
        setQuery={setQuery}
        status={status}
        setStatus={setStatus}
        method={method}
        setMethod={setMethod}
        sort={sort}
        setSort={setSort}
        hasActiveFilters={hasActiveFilters}
        onClear={() => {
          setQuery("");
          setStatus("all");
          setMethod("all");
          setSort("newest");
        }}
      />

      {error && (
        <div className="rounded-card border border-danger-200/80 bg-danger-50 px-4 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      {/* Column legend — mirrors TABLE_GRID so every month card below reads
          as one continuous, aligned table. Desktop only; mobile rows stack.
          Padding matches the rows' own box (px-5 + the card's 1px border and
          3px accent rail) so the two frames share a left edge. */}
      <div
        className={cn(
          "hidden lg:grid items-center gap-3 px-5 text-micro uppercase text-text-subtle",
          TABLE_GRID,
        )}
      >
        <span>Pay period</span>
        <span>Schedule</span>
        <span>Payment method</span>
        <span>Status</span>
        <span className="text-right">Gross pay</span>
        <span className="text-right">Net pay</span>
        <span className="text-right">Actions</span>
      </div>

      {months.length === 0 ? (
        <div className="rounded-card border border-border/70 bg-surface p-10 text-center text-sm text-text-muted shadow-card">
          No periods match these filters.
        </div>
      ) : (
        months.map((m) => (
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
        ))
      )}
    </div>
  );
}

// ── Filter bar ───────────────────────────────────────────────────────────

const SELECT_CLASS =
  "h-9 rounded-input border border-border bg-surface px-2.5 text-xs font-medium text-text transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60";

function FilterBar({
  scheduleTab,
  query,
  setQuery,
  status,
  setStatus,
  method,
  setMethod,
  sort,
  setSort,
  hasActiveFilters,
  onClear,
}: {
  scheduleTab: string;
  query: string;
  setQuery: (v: string) => void;
  status: StatusFilter;
  setStatus: (v: StatusFilter) => void;
  method: MethodFilter;
  setMethod: (v: MethodFilter) => void;
  sort: SortKey;
  setSort: (v: SortKey) => void;
  hasActiveFilters: boolean;
  onClear: () => void;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-border/70 bg-surface p-2.5 shadow-card">
      <label className="relative min-w-[10rem] flex-1">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pay runs..."
          aria-label="Search pay runs"
          className="h-9 w-full rounded-input border border-border bg-surface pl-8 pr-2.5 text-xs text-text placeholder:text-text-subtle transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
        />
      </label>
      <FilterSelect
        label="Schedule"
        value={scheduleTab}
        onChange={(v) =>
          router.push(v === "all" ? "/reports" : `/reports?schedule=${v}`)
        }
        options={[
          ["all", "All"],
          ["weekly", "Weekly"],
          ["semi-monthly", "Semi-monthly"],
          ["monthly", "Monthly"],
          ["salaried", "Salaried"],
        ]}
      />
      <FilterSelect
        label="Status"
        value={status}
        onChange={(v) => setStatus(v as StatusFilter)}
        options={[
          ["all", "All"],
          ["PAID", "Completed"],
          ["LOCKED", "Locked"],
          ["OPEN", "Open"],
        ]}
      />
      <FilterSelect
        label="Payment method"
        value={method}
        onChange={(v) => setMethod(v as MethodFilter)}
        options={[
          ["all", "All"],
          ["BANK", "Bank transfer"],
          ["CASH", "Cash drawer"],
        ]}
      />
      <FilterSelect
        label="Sort by"
        value={sort}
        onChange={(v) => setSort(v as SortKey)}
        options={[
          ["newest", "Pay period (desc)"],
          ["oldest", "Pay period (asc)"],
          ["net-desc", "Net pay (high)"],
          ["net-asc", "Net pay (low)"],
        ]}
      />
      {hasActiveFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-9 text-xs"
        >
          <X className="h-3.5 w-3.5" /> Clear filters
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="hidden text-micro uppercase text-text-subtle xl:inline">
        {label}
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={SELECT_CLASS}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
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
  const gross = monthGross(month);
  // W2 paystub periods have no gross figure (paystubs carry net only), so a
  // month containing them under-reports Total gross — flag it rather than
  // let gross read as smaller than net without explanation.
  const grossIncomplete = month.periods.some(
    (p) => periodGross(p) === 0 && periodNet(p) > 0,
  );
  const runCount = month.periods.reduce((n, p) => n + p.runs.length, 0);

  return (
    <section
      aria-label={month.label}
      className="overflow-hidden rounded-card border border-border/70 bg-surface shadow-card transition-shadow hover:shadow-card-strong"
    >
      {/* Month header. On lg it rides TABLE_GRID so the Total gross / Total
          net figures sit directly above the Gross pay / Net pay columns they
          total — previously this was a `flex justify-between` cluster pinned
          to the card's right edge, i.e. floating over the actions column and
          aligned with nothing. Below lg it falls back to the flex layout. */}
      <header
        className={cn(
          "flex items-center justify-between gap-3 border-b border-border/70 bg-surface-2/50 px-4 py-3 sm:px-5",
          "lg:grid lg:items-center lg:gap-3",
          TABLE_GRID,
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0 lg:col-span-4">
          <span
            aria-hidden="true"
            className="h-4 w-1 shrink-0 rounded-full bg-brand-700"
          />
          <h2 className="text-subheading tracking-tight text-text">
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
        <div className="flex items-center gap-5 whitespace-nowrap lg:contents">
          <div
            className="hidden flex-col items-end leading-none sm:flex"
            title={
              grossIncomplete
                ? "Partial: W2 paystub periods carry net pay only, so their gross isn't included here."
                : undefined
            }
          >
            <MicroLabel>Total gross{grossIncomplete ? "*" : ""}</MicroLabel>
            <span className="mt-1 tabular-nums text-subheading text-text-muted">
              <MoneyDisplay cents={gross} />
            </span>
          </div>
          <div className="flex flex-col items-end leading-none">
            <MicroLabel>Total net</MicroLabel>
            <span className="mt-1 tabular-nums text-subheading text-text">
              <MoneyDisplay cents={net} />
            </span>
          </div>
          <span aria-hidden className="hidden lg:block" />
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
    // Period-attached paystub groups carry the real period id (uuid) —
    // link back to that period's page. Salaried-tab uploads have only the
    // synthetic "salaried-paystub:" key and link to the Salaried tab.
    const rangeHref = group.periodId.startsWith("salaried-paystub:")
      ? "/payroll?schedule=salaried"
      : `/payroll/${group.periodId}`;
    return (
      <div className="group/row relative transition-colors hover:bg-surface-2/40">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px] bg-brand-700 opacity-70 transition-opacity group-hover/row:opacity-100"
        />
        <div className="py-3 pl-4 pr-4 sm:pl-5 sm:pr-5">
          <div
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2",
              TABLE_GRID,
            )}
          >
            {/* 1 · Pay period + docs count */}
            <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 lg:col-span-1">
              <Link
                href={rangeHref}
                className="rounded-input tabular-nums text-sm font-semibold tracking-tight text-text tabular-nums whitespace-nowrap transition-colors hover:text-brand-700"
              >
                {formatRange(group.periodStart, group.periodEnd)}
              </Link>
              <span className="inline-flex items-center gap-1 rounded-chip border border-info-100 bg-info-50 px-2 py-0.5 text-[10px] font-medium text-info-800">
                <FileText className="h-3 w-3" /> {docs.length}{" "}
                {docs.length === 1 ? "paystub" : "paystubs"}
              </span>
            </div>

            {/* Mobile chip cluster */}
            <div className="col-span-2 flex flex-wrap items-center gap-1.5 lg:hidden">
              <SchedulePill name={group.scheduleName ?? "Salaried"} />
              <StatusCell state="PAID" />
              <PaymentMethodCell
                state="PAID"
                method={group.runs[0]?.periodPaymentMethod ?? "BANK"}
              />
            </div>

            {/* 2 · Schedule — salaried staff still ride a real cadence */}
            <div className="hidden min-w-0 lg:block">
              <SchedulePill name={group.scheduleName ?? "Salaried"} />
            </div>

            {/* 3 · Payment method — W2 paystubs pay out via bank transfer */}
            <div className="hidden min-w-0 lg:flex">
              <PaymentMethodCell
                state="PAID"
                method={group.runs[0]?.periodPaymentMethod ?? "BANK"}
              />
            </div>

            {/* 4 · Status */}
            <div className="hidden min-w-0 lg:flex">
              <StatusCell state="PAID" />
            </div>

            {/* 5 · Gross — the W2 paystub carries net only */}
            <div className="hidden text-right tabular-nums text-sm tabular-nums text-text-subtle lg:block">
              —
            </div>

            {/* 6 · Net */}
            <div className="flex min-w-0 flex-col items-start leading-none lg:items-end">
              <span className="tabular-nums text-base font-semibold tracking-tight text-text">
                <MoneyDisplay cents={net} />
              </span>
              <span className="mt-1 tabular-nums text-[10px] leading-tight tabular-nums text-text-subtle">
                W2 net · uploaded paystubs
              </span>
            </div>

            {/* 7 · Actions */}
            <div className="flex items-center justify-end gap-0.5 justify-self-end">
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-9 w-9 p-0"
                  title={docs.length === 1 ? "View paystub" : "Manage paystubs"}
                >
                  {docs.length === 1 ? (
                    <PdfLink
                      href={`/api/payroll-docs/${docs[0]!.id}`}
                      filename={`paystub-${docs[0]!.employeeName}.pdf`}
                    >
                      <Eye className="h-4 w-4" />
                    </PdfLink>
                  ) : (
                    <Link href="/payroll?schedule=salaried">
                      <Eye className="h-4 w-4" />
                    </Link>
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-9 w-9 p-0"
                      title="Paystub actions"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[14rem]">
                    <DropdownMenuLabel>Paystubs</DropdownMenuLabel>
                    {docs.map((d) => (
                      <DropdownMenuItem key={d.id} asChild>
                        <PdfLink
                          href={`/api/payroll-docs/${d.id}`}
                          filename={`paystub-${d.employeeName}.pdf`}
                        >
                          <Eye className="h-3.5 w-3.5" /> View {d.employeeName}
                        </PdfLink>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/payroll?schedule=salaried">
                        <FileText className="h-3.5 w-3.5" /> Manage on Salaried tab
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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
        {/* Statement line — mobile stacks (range / chips / net+actions);
            lg lays out on the shared TABLE_GRID so every row's schedule,
            payment, status, gross and net columns align down the page. */}
        <div
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2",
            TABLE_GRID,
          )}
        >
          {/* 1 · Pay period */}
          <Link
            href={`/payroll/${group.periodId}`}
            className="col-span-2 min-w-0 justify-self-start rounded-input tabular-nums text-sm font-semibold tracking-tight text-text tabular-nums whitespace-nowrap transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 lg:col-span-1"
          >
            {formatRange(group.periodStart, canonicalEnd)}
          </Link>

          {/* Mobile chip cluster (lg gives each its own column) */}
          <div className="col-span-2 flex flex-wrap items-center gap-1.5 lg:hidden">
            <SchedulePill name={group.scheduleName} />
            <StatusCell state={periodState} />
            <PaymentChip state={periodState} method={periodPaymentMethod} />
            {!multiRun && soleRun && (
              <VisibilityChip published={soleRun.publishedToPortalAt !== null} />
            )}
          </div>

          {/* 2 · Schedule */}
          <div className="hidden min-w-0 lg:block">
            <SchedulePill name={group.scheduleName} />
          </div>

          {/* 3 · Payment method */}
          <div className="hidden min-w-0 lg:flex">
            <PaymentMethodCell state={periodState} method={periodPaymentMethod} />
          </div>

          {/* 4 · Status — one chip plus a glyph, on a single line, so every
              row in the table is the same height. */}
          <div className="hidden min-w-0 flex-nowrap items-center gap-1.5 lg:flex">
            <StatusCell state={periodState} />
            {!multiRun && soleRun && (
              <VisibilityChip published={soleRun.publishedToPortalAt !== null} />
            )}
          </div>

          {/* 5 · Gross (own column at lg; folded into the net addenda below lg) */}
          <div className="hidden text-right tabular-nums text-sm tabular-nums text-text-muted lg:block">
            {gross > 0 ? (
              <MoneyDisplay cents={gross} />
            ) : (
              <span className="text-text-subtle">—</span>
            )}
          </div>

          {/* 6 · Net */}
          <div className="flex min-w-0 flex-col items-start leading-none lg:items-end">
            <span className="tabular-nums text-base font-semibold tracking-tight text-text">
              <MoneyDisplay cents={net} />
            </span>
            {(gross > 0 && gross !== net) ||
            group.docNetPayCents > 0 ||
            group.tempLaborCents > 0 ? (
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0 tabular-nums text-[10px] leading-tight tabular-nums lg:justify-end">
                {gross > 0 && gross !== net && (
                  <span className="text-text-subtle lg:hidden">
                    gross <MoneyDisplay cents={gross} monospace={false} />
                  </span>
                )}
                {group.docNetPayCents > 0 && (
                  <span
                    className="text-success-700"
                    title="This period's net is the real W2 take-home from the uploaded paystub(s), not the run's pre-tax amount."
                  >
                    W2 take-home
                  </span>
                )}
                {group.tempLaborCents > 0 && (
                  <span className="text-text-subtle">
                    incl. <MoneyDisplay cents={group.tempLaborCents} monospace={false} /> temp
                  </span>
                )}
              </span>
            ) : null}
          </div>

          {/* 7 · Actions — every control is a 36px square so the cluster is
              the same width whether or not this period can be paid. A
              variable-width cluster used to resize the grid's last track per
              row, dragging all six other columns out of alignment. */}
          <div className="flex items-center justify-end gap-0.5 justify-self-end">
            {canManageReports && periodState === "LOCKED" && (
              <IconButton
                variant="secondary"
                sizePx="sm"
                onClick={() => setPayOpen((v) => !v)}
                aria-label="Pay from cash drawer"
                title={`Pay from cash drawer — $${(drawerBalanceCents / 100).toFixed(2)} on hand`}
                className="h-9 w-9"
              >
                <Banknote className="h-3.5 w-3.5" aria-hidden />
              </IconButton>
            )}
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
        <div className="mt-3 rounded-input border border-warning-200/70 bg-warning-50/50 px-3 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <p className="text-micro uppercase text-text-subtle">
                Drawer balance
              </p>
              <p className="tabular-nums text-sm font-semibold">
                <MoneyDisplay cents={drawerBalanceCents} />
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-micro uppercase text-text-subtle">
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
      )}
      </div>
    </div>
  );
}

/** Period status chip — the mockup's single loud state cue per row.
 *  PAID reads as "Completed"; LOCKED and OPEN stay literal. */
/** Period state chip. Tones come from the shared status vocabulary so this
 *  reads identically to the same period's chip on /payroll. */
function StatusCell({ state }: { state: "OPEN" | "LOCKED" | "PAID" }) {
  const spec = {
    PAID: { tone: "success", label: "Completed", Icon: CheckCircle2 },
    LOCKED: { tone: "warn", label: "Locked", Icon: Lock },
    OPEN: { tone: "info", label: "Open", Icon: CircleDot },
  }[state] as { tone: StatusTone; label: string; Icon: typeof Lock };
  const { Icon } = spec;
  return (
    <span className={cn(STATUS_CHIP_BASE, statusChipClasses(spec.tone))}>
      <Icon className="h-3 w-3" aria-hidden /> {spec.label}
    </span>
  );
}

/** Payment-method table cell — quiet icon + text (calm pass: the status
 *  chip is the single colored element per row; this column just states
 *  the rail, like the reference mock). */
function PaymentMethodCell({
  state,
  method,
}: {
  state: "OPEN" | "LOCKED" | "PAID";
  method: "BANK" | "CASH" | null;
}) {
  if (state !== "PAID") {
    return <span className="text-xs text-text-subtle">—</span>;
  }
  if (method === "CASH") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted whitespace-nowrap">
        <Banknote className="h-3.5 w-3.5 text-text-subtle" aria-hidden /> Cash drawer
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted whitespace-nowrap">
      <Landmark className="h-3.5 w-3.5 text-text-subtle" aria-hidden /> Bank transfer
    </span>
  );
}

/** Period payment-method chip (PAID, mobile cluster) — quiet neutral. */
function PaymentChip({
  state,
  method,
}: {
  state: "OPEN" | "LOCKED" | "PAID";
  method: "BANK" | "CASH" | null;
}) {
  if (state !== "PAID") return null;
  const Icon = method === "CASH" ? Banknote : Landmark;
  const label = method === "CASH" ? "Cash drawer" : "Bank transfer";
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-border/70 bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted whitespace-nowrap">
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

/** Portal visibility chip (per run). */
/**
 * Employee-visibility indicator. Deliberately a glyph, not a second chip:
 * two full chips wrapped onto a second line in the status column, so rows
 * with a publication state stood ~20px taller than rows without and the
 * table read as ragged.
 */
function VisibilityChip({ published }: { published: boolean }) {
  const label = published ? "Visible to employees" : "Internal only";
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
        published ? "text-success-700" : "text-text-subtle",
      )}
    >
      {published ? (
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <CircleDot className="h-3.5 w-3.5" aria-hidden />
      )}
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
