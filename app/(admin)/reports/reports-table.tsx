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
import { cn } from "@/lib/utils";
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import type { ZohoOrganization } from "@/lib/db/schema";
import {
  deleteReportAction,
  publishReportAction,
  pushReportToZohoAction,
  repushReportToZohoAction,
} from "@/app/(admin)/reports/actions";

import { TABLE_GRID } from "@/components/reports/table/shared";
import { MonthCard } from "@/components/reports/table/month-card";
import { FilterBar } from "@/components/reports/table/filter-bar";
import { Pager } from "@/components/reports/table/pager";
import {
  groupByPeriod,
  groupByMonth,
  periodNet,
  matchesFilters,
  PAGE_SIZE,
  type StatusFilter,
  type MethodFilter,
  type SortKey,
} from "@/lib/reports/table-model";

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
  const [page, setPage] = React.useState(1);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  // Any filter change lands back on page 1.
  React.useEffect(() => {
    setPage(1);
  }, [query, status, method, sort, scheduleTab]);

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
  const orderedAll =
    sort === "oldest" ? [...filtered].reverse() : filtered;
  const totalPeriods = orderedAll.length;
  const pageCount = Math.max(1, Math.ceil(totalPeriods / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const ordered = orderedAll.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
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

  const periodCount = totalPeriods;

  return (
    <div className="overflow-hidden rounded-card border border-border/70 bg-surface shadow-card">
      <FilterBar
        periodCount={periodCount}
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
        <div className="border-b border-danger-200/80 bg-danger-50 px-4 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      {/* Column header — mirrors TABLE_GRID so every month section below
          reads as one continuous, aligned table. Desktop only; mobile rows
          stack. Sticky so the columns stay named while scrolling a year. */}
      <div
        className={cn(
          "sticky top-0 z-10 hidden items-center gap-3 border-b border-border/70 bg-surface px-5 py-2 text-micro uppercase text-text-subtle lg:grid",
          TABLE_GRID,
        )}
      >
        <span>Pay period</span>
        <span>Schedule</span>
        <span>Paid via</span>
        <span>Status</span>
        <span className="text-right">Gross pay</span>
        <span className="text-right">Net pay</span>
        <span className="text-right">Employees</span>
        <span className="text-right">Actions</span>
      </div>

      {months.length === 0 ? (
        <div className="p-10 text-center text-sm text-text-muted">
          No periods match these filters.
        </div>
      ) : (
        months.map((m) => (
          <MonthCard
            key={m.key}
            month={m}
            collapsed={collapsed.has(m.key)}
            onToggle={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(m.key)) next.delete(m.key);
                else next.add(m.key);
                return next;
              })
            }
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

      <Pager
        page={safePage}
        pageCount={pageCount}
        from={totalPeriods === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}
        to={Math.min(totalPeriods, safePage * PAGE_SIZE)}
        total={totalPeriods}
        onPage={setPage}
      />
    </div>
  );
}
