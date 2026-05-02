"use client";

import * as React from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deletePeriodAction } from "./period-delete-action";

/**
 * Per-period destructive delete. Two-step confirm — the user types
 * "delete period" (or "delete paid period" for PAID rows). Cascades
 * all attached runs/payslips and soft-deletes punches.
 */
export function PeriodDeleteButton({
  periodId,
  state,
}: {
  periodId: string;
  state: "OPEN" | "LOCKED" | "PAID";
}) {
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const expected = state === "PAID" ? "delete paid period" : "delete period";

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        title="Delete this period (cascade)"
        className="text-danger-700 hover:bg-danger-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <form
      action={async (form) => {
        if (confirm.trim() !== expected) {
          setError(`Type "${expected}" to confirm.`);
          return;
        }
        setPending(true);
        setError(null);
        form.set("periodId", periodId);
        form.set("confirm", confirm.trim());
        const r = await deletePeriodAction(form);
        setPending(false);
        if ("error" in r) setError(r.error);
        // Success: page revalidates server-side, no need to handle here.
      }}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-2 rounded-input border border-danger-200 bg-danger-50 px-2 py-1.5"
    >
      <AlertTriangle className="h-3.5 w-3.5 text-danger-700 shrink-0" />
      <Input
        type="text"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onClick={(e) => e.preventDefault()}
        placeholder={expected}
        autoFocus
        className="h-7 text-xs w-44"
      />
      <Button
        type="submit"
        size="sm"
        variant="destructive"
        disabled={pending || confirm.trim() !== expected}
        className="h-7"
      >
        {pending ? "…" : "Delete"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={(e) => {
          e.preventDefault();
          setOpen(false);
          setConfirm("");
          setError(null);
        }}
        className="h-7"
      >
        Cancel
      </Button>
      {error && (
        <span className="text-xs text-danger-700 ml-1">{error}</span>
      )}
    </form>
  );
}
