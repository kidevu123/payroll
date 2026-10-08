"use client";

// A salaried W2 paystub period in the ledger: a simple statement line with no
// payroll-run actions (the documents are managed on the Salaried tab).
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import Link from "next/link";
import { PdfLink } from "@/components/domain/pdf-link";
import { formatPeriodRange as formatRange } from "@/lib/payroll/format-period";
import { cn } from "@/lib/utils";
import { Eye, MoreHorizontal, FileText } from "lucide-react";
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

import { TABLE_GRID } from "@/components/reports/table/shared";
import { PaymentMethodCell, StatusCell } from "@/components/reports/table/cells";
import { type GroupedReport } from "@/lib/reports/table-model";


export function PaystubPeriodLine({
  group,
  paystubRun,
  net,
}: {
  group: GroupedReport;
  paystubRun: ReportRow;
  net: number;
}) {
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
