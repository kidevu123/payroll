"use client";

import * as React from "react";
import Link from "next/link";
import { Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wipePunchesAfterAction } from "../wipe-action";

export function WipePunchesPanel() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<
    { voided: number; fromDate: string } | null
  >(null);
  const [confirm, setConfirm] = React.useState("");

  if (result) {
    return (
      <div className="rounded-card border border-success-200 bg-success-50 p-5 space-y-2">
        <h2 className="text-lg font-semibold text-success-700 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5" /> Done
        </h2>
        <p className="text-sm text-text-muted">
          Soft-deleted {result.voided.toLocaleString()} punch
          {result.voided === 1 ? "" : "es"} with clock_in on or after{" "}
          <span className="font-mono">{result.fromDate}</span>. They will not
          count in any future payslip recomputation, but the rows are still
          present in the punches table with a non-null voided_at.
        </p>
        <div className="flex gap-2 pt-2">
          <Button asChild variant="secondary" size="sm">
            <Link href="/time">Back to Time</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/punches/new">Add manual punch</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      action={async (form) => {
        if (confirm.trim() !== "wipe punches") {
          setError("Type 'wipe punches' to confirm.");
          return;
        }
        setPending(true);
        setError(null);
        form.set("confirm", confirm.trim());
        const r = await wipePunchesAfterAction(form);
        setPending(false);
        if ("error" in r) setError(r.error);
        else setResult({ voided: r.voided, fromDate: r.fromDate });
      }}
      className="space-y-4 rounded-card border-2 border-danger-200 bg-danger-50 p-5"
    >
      <h2 className="text-lg font-semibold text-danger-700 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5" /> Danger zone
      </h2>

      <div className="space-y-1">
        <Label htmlFor="fromDate">Wipe from this date forward (inclusive)</Label>
        <Input
          id="fromDate"
          name="fromDate"
          type="date"
          defaultValue="2026-04-27"
          required
        />
        <p className="text-xs text-text-muted">
          Every non-voided punch with clock_in &gt;= this date gets marked
          voided. Punches before this date are untouched.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="confirm">
          Type{" "}
          <span className="font-mono px-1 py-0.5 bg-surface-2 rounded">
            wipe punches
          </span>{" "}
          to confirm
        </Label>
        <Input
          id="confirm"
          name="confirm-display"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {error && (
        <p className="text-sm text-red-700 rounded-input bg-red-100 px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="destructive"
          disabled={pending || confirm.trim() !== "wipe punches"}
        >
          <Trash2 className="h-4 w-4" />
          {pending ? "Wiping…" : "Wipe punches"}
        </Button>
      </div>
    </form>
  );
}
