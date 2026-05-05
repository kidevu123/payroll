"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordDepositAction, recordWithdrawalAction } from "./actions";

export function DepositForm() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        setPending(true);
        setError(null);
        setOk(false);
        const r = await recordDepositAction(fd);
        setPending(false);
        if (r && "error" in r && r.error) setError(r.error);
        else {
          setOk(true);
          formRef.current?.reset();
        }
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="dep-amount">Amount ($)</Label>
          <Input
            id="dep-amount"
            name="amountDollars"
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            required
            disabled={pending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dep-invoice">Invoice number</Label>
          <Input
            id="dep-invoice"
            name="invoiceNumber"
            type="text"
            required
            disabled={pending}
            placeholder="INV-12345"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="dep-notes">Notes (optional)</Label>
        <Input id="dep-notes" name="notes" type="text" disabled={pending} />
      </div>
      <div className="flex items-center justify-between gap-2">
        {error && <p className="text-xs text-red-700">{error}</p>}
        {ok && <p className="text-xs text-emerald-700">Deposit recorded.</p>}
        <Button type="submit" disabled={pending} className="ml-auto">
          {pending ? "Recording…" : "Record deposit"}
        </Button>
      </div>
    </form>
  );
}

export function WithdrawForm() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [ok, setOk] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (fd) => {
        setPending(true);
        setError(null);
        setOk(false);
        const r = await recordWithdrawalAction(fd);
        setPending(false);
        if (r && "error" in r && r.error) setError(r.error);
        else {
          setOk(true);
          formRef.current?.reset();
        }
      }}
      className="space-y-3"
    >
      <div className="space-y-1">
        <Label htmlFor="wd-amount">Amount ($)</Label>
        <Input
          id="wd-amount"
          name="amountDollars"
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          required
          disabled={pending}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="wd-notes">Reason / notes</Label>
        <Input id="wd-notes" name="notes" type="text" disabled={pending} />
      </div>
      <div className="flex items-center justify-between gap-2">
        {error && <p className="text-xs text-red-700">{error}</p>}
        {ok && <p className="text-xs text-emerald-700">Withdrawal recorded.</p>}
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          className="ml-auto"
        >
          {pending ? "Recording…" : "Withdraw"}
        </Button>
      </div>
    </form>
  );
}
