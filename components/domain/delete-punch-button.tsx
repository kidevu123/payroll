"use client";

// Delete (void) one punch, from anywhere a punch is listed. Two steps so a
// stray click cannot remove a shift: the button opens a small confirm with a
// reason, which is recorded in the audit log. The punch is voided, never
// erased, so it stays in the history and can be traced.
//
// Built for the clock picking someone up as they walk past: that leaves a
// lone punch with nothing to pair it with, and the day editor only offered
// to "complete" it.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { voidPunchAction } from "@/app/(admin)/time/actions";

const DEFAULT_REASON = "Not a real shift";

export function DeletePunchButton({
  punchId,
  /** What the punch is, for the confirm line and screen readers. */
  describe,
  label = "Delete",
  variant = "ghost",
}: {
  punchId: string;
  describe: string;
  label?: string;
  variant?: "ghost" | "secondary" | "destructive";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        className={variant === "ghost" ? "text-danger-700 hover:text-danger-700" : undefined}
        aria-label={`${label}: ${describe}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden /> {label}
      </Button>
    );
  }

  return (
    <form
      action={(form) => {
        setError(null);
        startTransition(async () => {
          const result = await voidPunchAction(punchId, form);
          if (result?.error) {
            setError(result.error);
            return;
          }
          setOpen(false);
          router.refresh();
        });
      }}
      className="w-full space-y-2 rounded-input border border-danger-200 bg-danger-50/40 p-3 text-sm"
    >
      <p className="font-medium text-text">Delete this punch? {describe}</p>
      <label className="block space-y-1">
        <span className="text-xs text-text-muted">Reason (kept in the audit log)</span>
        <Input
          name="reason"
          required
          minLength={1}
          maxLength={500}
          defaultValue={DEFAULT_REASON}
          autoFocus
        />
      </label>
      {error ? (
        <p role="alert" className="text-danger-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {pending ? "Deleting…" : "Confirm delete"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
