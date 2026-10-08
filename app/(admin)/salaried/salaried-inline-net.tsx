"use client";

// Inline editor for a paystub's net amount.
import * as React from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setSalariedDocNetAmountAction } from "./actions";
import { centsToInput, formatMoney, type DocLite } from "@/lib/salaried/upload-format";

/**
 * Inline-editable net amount. Click the amount → it becomes an input →
 * save persists via the existing audited action. Replaces the old
 * separate "Save net" yellow box. W2/Other rows just show their amount
 * (or nothing) and aren't editable here.
 */
export function InlineNet({ doc }: { doc: DocLite }) {
  // Paystub nets stay editable even after a Zoho push — correcting a mistake
  // is exactly when you need it. Re-push (in ZohoDocStatus) resyncs Zoho.
  const editable = doc.kind === "PAYSTUB";
  const hasAmount = doc.amountCents !== null && doc.amountCents > 0;

  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(
    hasAmount ? centsToInput(doc.amountCents as number) : "",
  );
  const [amountCents, setAmountCents] = React.useState<number | null>(doc.amountCents);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const liveHasAmount = amountCents !== null && amountCents > 0;

  // Non-paystub or already-in-Zoho: read-only display.
  if (!editable) {
    if (!liveHasAmount) return null;
    return (
      <span className="tabular-nums text-xs text-text-muted">
        {formatMoney(amountCents as number)}
      </span>
    );
  }

  async function save() {
    setPending(true);
    setError(null);
    const r = await setSalariedDocNetAmountAction(doc.id, value.trim());
    setPending(false);
    if (r?.error) {
      setError(r.error);
      return;
    }
    const cents = Math.round(Number(value.trim()) * 100);
    setAmountCents(cents);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <Input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="1702.42"
          className="h-7 w-24 tabular-nums text-xs"
          disabled={pending}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void save()}
          disabled={pending}
          title="Save net"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success-700" />
          )}
        </Button>
        {error && (
          <span className="max-w-[10rem] text-[10px] text-danger-700">{error}</span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit net pay"
      className={[
        "rounded-chip px-2 py-0.5 tabular-nums text-xs transition-colors",
        liveHasAmount
          ? "text-text hover:bg-surface-2/40"
          : "bg-warning-50 text-warning-700 hover:bg-warning-50/80",
      ].join(" ")}
    >
      {liveHasAmount ? formatMoney(amountCents as number) : "Add net $"}
    </button>
  );
}
