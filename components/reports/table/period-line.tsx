"use client";

// One pay period in the ledger, with its run sub-lines when it has several.
import * as React from "react";
import Link from "next/link";
import { PdfLink } from "@/components/domain/pdf-link";
import { formatPeriodRange as formatRange } from "@/lib/payroll/format-period";
import { cn } from "@/lib/utils";
import { Eye, MoreHorizontal, FileText, Banknote } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
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
import { markPaidAction } from "@/app/(admin)/payroll/actions";

import { TABLE_GRID, type SharedHandlers } from "@/components/reports/table/shared";
import {
  PaymentChip,
  PaymentMethodCell,
  StatusCell,
  VisibilityChip,
  ZohoBadges,
} from "@/components/reports/table/cells";
import { RunActions } from "@/components/reports/table/row-actions";
import {
  formatDate,
  periodNet,
  periodGross,
  type GroupedReport,
} from "@/lib/reports/table-model";

export function PeriodLine({
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
        <div className="py-2 pl-4 pr-4 sm:pl-5 sm:pr-5">
          <div
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2",
              TABLE_GRID,
            )}
          >
            {/* 1 · Pay period. The paystub count lives in the net footnote
                so this row stays the same height as every other row. */}
            <Link
              href={rangeHref}
              className="col-span-2 min-w-0 justify-self-start rounded-input tabular-nums text-sm font-medium tracking-tight text-text whitespace-nowrap transition-colors hover:text-brand-700 lg:col-span-1"
            >
              {formatRange(group.periodStart, group.periodEnd)}
            </Link>

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
            <div className="hidden pr-2 text-right tabular-nums text-sm text-text-subtle lg:block">
              —
            </div>

            {/* 6 · Net */}
            <div className="flex min-w-0 flex-col items-start leading-none lg:items-end">
              <span className="tabular-nums text-sm font-semibold tracking-tight text-text">
                <MoneyDisplay cents={net} />
              </span>
              <span className="mt-1 whitespace-nowrap tabular-nums text-[10px] leading-tight text-text-subtle">
                W2 net · {docs.length} {docs.length === 1 ? "paystub" : "paystubs"}
              </span>
            </div>

            {/* 7 · Employees — one paystub per person */}
            <div className="hidden text-right text-sm tabular-nums text-text-muted lg:block">
              {docs.length}
            </div>

            {/* 8 · Actions */}
            <div className="flex items-center justify-end gap-0.5 justify-self-end text-text-muted">
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
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
                      className="h-8 w-8 p-0"
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
      <div className="py-2 pl-4 pr-4 sm:pl-5 sm:pr-5">
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
            className="col-span-2 min-w-0 justify-self-start rounded-input tabular-nums text-sm font-medium tracking-tight text-text whitespace-nowrap transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/40 lg:col-span-1"
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
          <div className="hidden pr-2 text-right tabular-nums text-sm text-text-muted lg:block">
            {gross > 0 ? (
              <MoneyDisplay cents={gross} />
            ) : (
              <span className="text-text-subtle">—</span>
            )}
          </div>

          {/* 6 · Net */}
          <div className="flex min-w-0 flex-col items-start leading-none lg:items-end">
            <span className="tabular-nums text-sm font-semibold tracking-tight text-text">
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

          {/* 7 · Employees paid this period */}
          <div className="hidden text-right text-sm tabular-nums text-text-muted lg:block">
            {group.employeesPaid ?? <span className="text-text-subtle">—</span>}
          </div>

          {/* 8 · Actions — fixed-width cluster so the last track never
              resizes per row. */}
          <div className="flex items-center justify-end gap-0.5 justify-self-end text-text-muted">
            {canManageReports && periodState === "LOCKED" && (
              <IconButton
                variant="secondary"
                sizePx="sm"
                onClick={() => setPayOpen((v) => !v)}
                aria-label="Pay from cash drawer"
                title={`Pay from cash drawer — $${(drawerBalanceCents / 100).toFixed(2)} on hand`}
                className="h-8 w-8"
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
