"use client";

import * as React from "react";
import { MoreHorizontal, Pencil, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  recordDepositAction,
  recordWithdrawalAction,
  recordPettyCashAction,
  voidEntryAction,
  updateEntryAction,
} from "./actions";

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
        {error && <p className="text-xs text-danger-700">{error}</p>}
        {ok && <p className="text-xs text-success-700">Deposit recorded.</p>}
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
        {error && <p className="text-xs text-danger-700">{error}</p>}
        {ok && <p className="text-xs text-success-700">Withdrawal recorded.</p>}
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

export function PettyCashForm() {
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
        const r = await recordPettyCashAction(fd);
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
          <Label htmlFor="pc-amount">Amount ($)</Label>
          <Input
            id="pc-amount"
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
          <Label htmlFor="pc-ref">Receipt / ref (optional)</Label>
          <Input
            id="pc-ref"
            name="reference"
            type="text"
            disabled={pending}
            placeholder="RCPT-001"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pc-desc">What was purchased</Label>
        <Input
          id="pc-desc"
          name="description"
          type="text"
          required
          disabled={pending}
          placeholder="e.g. office supplies, stamps"
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {error && <p className="text-xs text-danger-700">{error}</p>}
        {ok && <p className="text-xs text-success-700">Purchase recorded.</p>}
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          className="ml-auto"
        >
          {pending ? "Recording…" : "Record purchase"}
        </Button>
      </div>
    </form>
  );
}

export function LedgerRowActions({
  entryId,
  kind,
  amountCents,
  notes,
  invoiceNumber,
  canEdit,
}: {
  entryId: string;
  kind: "DEPOSIT" | "WITHDRAWAL";
  amountCents: number;
  notes: string | null;
  invoiceNumber: string | null;
  /** False for payroll-linked entries — they're managed via the period. */
  canEdit: boolean;
}) {
  const [mode, setMode] = React.useState<"idle" | "edit" | "confirm">("idle");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState((amountCents / 100).toFixed(2));
  const [noteVal, setNoteVal] = React.useState(notes ?? "");
  const [invVal, setInvVal] = React.useState(invoiceNumber ?? "");

  if (!canEdit) {
    return (
      <span className="text-[10px] text-text-subtle" title="Recorded by a payroll run — manage from the period.">
        payroll
      </span>
    );
  }

  async function save() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("entryId", entryId);
    fd.set("amountDollars", amount);
    fd.set("notes", noteVal);
    if (kind === "DEPOSIT") fd.set("invoiceNumber", invVal);
    const r = await updateEntryAction(fd);
    setPending(false);
    if (r && "error" in r && r.error) setError(r.error);
    else setMode("idle");
  }

  async function del() {
    setPending(true);
    setError(null);
    const r = await voidEntryAction(entryId);
    setPending(false);
    if (r && "error" in r && r.error) {
      setError(r.error);
      setMode("idle");
    }
  }

  return (
    <div className="relative inline-flex items-center justify-end">
      {mode === "confirm" ? (
        <span className="inline-flex items-center gap-1">
          <span className="text-[11px] text-danger-700">Delete?</span>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setMode("idle")} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-danger-700" onClick={() => void del()} disabled={pending}>
            {pending ? "…" : "Confirm"}
          </Button>
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-10 w-10 md:h-8 md:w-8 p-0" title="Entry actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setMode("edit");
              }}
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setMode("confirm");
              }}
            >
              <Trash2 className="h-3.5 w-3.5 text-danger-700" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {mode === "edit" && (
        <div className="absolute right-0 top-9 z-30 w-64 space-y-2 rounded-card border border-border bg-surface p-3 text-left shadow-card-strong">
          <div className="space-y-1">
            <Label htmlFor={`ed-amt-${entryId}`} className="text-[11px]">Amount ($)</Label>
            <Input
              id={`ed-amt-${entryId}`}
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={pending}
              className="h-8"
            />
          </div>
          {kind === "DEPOSIT" && (
            <div className="space-y-1">
              <Label htmlFor={`ed-inv-${entryId}`} className="text-[11px]">Invoice number</Label>
              <Input
                id={`ed-inv-${entryId}`}
                value={invVal}
                onChange={(e) => setInvVal(e.target.value)}
                disabled={pending}
                className="h-8"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`ed-note-${entryId}`} className="text-[11px]">Notes</Label>
            <Input
              id={`ed-note-${entryId}`}
              value={noteVal}
              onChange={(e) => setNoteVal(e.target.value)}
              disabled={pending}
              className="h-8"
            />
          </div>
          {error && <p className="text-[11px] text-danger-700">{error}</p>}
          <div className="flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setMode("idle")} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 px-2 text-[11px]" onClick={() => void save()} disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
      )}
      {mode !== "edit" && error && (
        <span className="ml-1 text-[10px] text-danger-700">{error}</span>
      )}
    </div>
  );
}
