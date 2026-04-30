"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { archiveEmployeeAction } from "../actions";

export function ArchiveEmployeeButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  if (!open) {
    return (
      <div className="rounded-[--radius-card] border border-dashed border-red-200 bg-red-50/40 p-4">
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          <Trash2 className="h-4 w-4" /> Archive employee
        </Button>
        <p className="mt-2 text-xs text-[--text-muted]">
          Soft-delete: status flips to TERMINATED and the row stays in the
          database for historical reports.
        </p>
      </div>
    );
  }

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        const result = await archiveEmployeeAction(id, form);
        setPending(false);
        if (result?.error) setError(result.error);
      }}
      className="space-y-2 rounded-[--radius-card] border border-red-200 bg-red-50/40 p-4"
    >
      <p className="text-sm font-medium text-[--text]">
        Archive {name}? Provide a reason for the audit log.
      </p>
      <input
        name="reason"
        required
        minLength={1}
        maxLength={500}
        placeholder="e.g. Voluntary departure 2026-04-30"
        className="h-10 w-full rounded-[--radius-input] border border-[--border] bg-[--surface] px-3 text-sm"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={pending}>
          {pending ? "Archiving…" : "Confirm archive"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
