"use client";

// Inline panel under a LOCKED period: pay it from the cash drawer.
import { Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/domain/money-display";



export function PayFromDrawerPanel({
  drawerBalanceCents,
  payAmount,
  setPayAmount,
  paying,
  onPay,
  onCancel,
}: {
  drawerBalanceCents: number;
  payAmount: string;
  setPayAmount: (v: string) => void;
  paying: boolean;
  onPay: () => void;
  onCancel: () => void;
}) {
  return (
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
        <Button size="sm" onClick={onPay} disabled={paying} className="h-9">
          <Banknote className="h-4 w-4" />
          {paying ? "Paying…" : "Pay this period from drawer"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
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
  );
}
