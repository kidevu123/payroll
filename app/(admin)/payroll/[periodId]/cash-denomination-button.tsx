"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Banknote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/domain/money-display";
import {
  CASH_DENOMINATIONS,
  type CashDenominationSummary,
} from "@/lib/payroll/cash-denominations";

export function CashDenominationButton({
  summary,
  periodLabel,
}: {
  summary: CashDenominationSummary;
  periodLabel: string;
}) {
  const hasRows = summary.rows.length > 0;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!hasRows}
        >
          <Banknote className="h-4 w-4" />
          Bank cash list
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-[5vh] z-[60] flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-4xl -translate-x-1/2 flex-col overflow-hidden rounded-card border border-border bg-surface shadow-pop">
          <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
            <div>
              <Dialog.Title className="text-base font-semibold tracking-tight">
                Bank cash list
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-text-muted">
                {periodLabel} · per-employee envelope breakdown using $100,
                $50, $20, $10, $5, and $1 bills.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-input text-text-muted hover:bg-surface-2 hover:text-text sm:h-8 sm:w-8"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto p-4 sm:p-5">
            {summary.remainderCents > 0 && (
              <div className="mb-4 rounded-card border border-warn-200 bg-warn-50 px-3 py-2 text-xs text-warn-800">
                Warning: this payroll has{" "}
                <MoneyDisplay cents={summary.remainderCents} /> in cents
                remainder. Payroll should be rounded to whole dollars before
                cash pickup.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              {summary.denominations.map((denomination) => (
                <div
                  key={denomination.value}
                  className="min-w-0 rounded-card border border-border bg-surface-2 px-2.5 py-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                    ${denomination.value}s
                  </div>
                  <div className="mt-1 tabular-nums text-xl font-semibold tabular-nums">
                    {denomination.count}
                  </div>
                  <div className="truncate text-[11px] text-text-muted">
                    <MoneyDisplay cents={denomination.totalCents} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-card border border-border bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Total cash
                </span>
                <span className="tabular-nums text-lg font-semibold">
                  <MoneyDisplay cents={summary.totalCents} />
                </span>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto rounded-card border border-border">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-text-subtle">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Employee</th>
                    <th className="px-3 py-2 text-right font-semibold">Pay</th>
                    {CASH_DENOMINATIONS.map((denomination) => (
                      <th
                        key={denomination}
                        className="px-3 py-2 text-right font-semibold"
                      >
                        ${denomination}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {summary.rows.map((row) => (
                    <tr key={row.employeeId}>
                      <td className="px-3 py-2 font-medium">{row.employeeName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <MoneyDisplay cents={row.roundedPayCents} />
                      </td>
                      {CASH_DENOMINATIONS.map((denomination) => (
                        <td
                          key={denomination}
                          className="px-3 py-2 text-right tabular-nums"
                        >
                          {row.bills[denomination] || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
