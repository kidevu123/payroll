"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { TempWorkerEntry } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import {
  createTempWorkerAction,
  deleteTempWorkerAction,
} from "./temp-workers-actions";

export function TempWorkersSection({
  periodId,
  initialEntries,
  locked,
}: {
  periodId: string;
  initialEntries: TempWorkerEntry[];
  /** When the period is PAID we still show the list, but block edits. */
  locked: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const total = initialEntries.reduce((acc, e) => acc + e.amountCents, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Temp / manual labor</CardTitle>
          <CardDescription>
            One-off contractors, day-labor, or anyone who doesn&apos;t punch in
            but whose pay must roll into this period&apos;s total.
          </CardDescription>
        </div>
        {!locked && (
          <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
            <Plus className="h-4 w-4" /> Add temp worker
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {open && !locked && (
          <form
            action={async (form) => {
              setPending(true);
              setError(null);
              const result = await createTempWorkerAction(periodId, form);
              setPending(false);
              if (result?.error) setError(result.error);
              else setOpen(false);
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-card border border-border bg-surface-2/50 p-3"
          >
            <div className="space-y-1">
              <Label htmlFor="workerName">Worker name</Label>
              <Input id="workerName" name="workerName" required maxLength={200} placeholder="e.g. Chintu" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="amount">Amount (USD)</Label>
              <Input id="amount" name="amount" required type="number" step="0.01" min="0.01" placeholder="200.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hours">Hours (optional)</Label>
              <Input id="hours" name="hours" type="number" step="0.01" min="0" placeholder="" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Job description</Label>
              <Input id="description" name="description" maxLength={500} placeholder="Loading dock day labor" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4 space-y-1">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input id="notes" name="notes" maxLength={1000} />
            </div>
            {error && (
              <p className="sm:col-span-2 lg:col-span-4 text-sm text-red-700">{error}</p>
            )}
            <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Adding…" : "Add"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {initialEntries.length === 0 ? (
          <p className="text-sm text-text-muted">
            No temp workers recorded for this period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
                <tr>
                  <th className="py-2 pr-3 font-medium">Worker</th>
                  <th className="py-2 px-3 font-medium">Description</th>
                  <th className="py-2 px-3 font-medium text-right">Hours</th>
                  <th className="py-2 px-3 font-medium text-right">Amount</th>
                  <th className="py-2 pl-3 pr-1 font-medium text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {initialEntries.map((e) => (
                  <TempWorkerRow key={e.id} entry={e} locked={locked} />
                ))}
              </tbody>
              <tfoot className="text-sm font-medium">
                <tr className="border-t-2 border-border">
                  <td className="py-2 pr-3" colSpan={3}>
                    Temp labor subtotal
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums">
                    <MoneyDisplay cents={total} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TempWorkerRow({
  entry,
  locked,
}: {
  entry: TempWorkerEntry;
  locked: boolean;
}) {
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <>
      <tr className="hover:bg-surface-2/40 transition-colors">
        <td className="py-2 pr-3 font-medium">{entry.workerName}</td>
        <td className="py-2 px-3 text-text-muted">{entry.description ?? "—"}</td>
        <td className="py-2 px-3 text-right font-mono tabular-nums text-text-muted">
          {entry.hours ?? "—"}
        </td>
        <td className="py-2 px-3 text-right font-mono tabular-nums">
          <MoneyDisplay cents={entry.amountCents} />
        </td>
        <td className="py-2 pl-3 pr-1 text-right">
          {!locked && (
            <form
              action={async () => {
                if (removing) return;
                setRemoving(true);
                setError(null);
                const result = await deleteTempWorkerAction(entry.id);
                setRemoving(false);
                if (result?.error) setError(result.error);
              }}
            >
              <Button type="submit" variant="ghost" size="sm" disabled={removing}>
                <Trash2 className="h-3 w-3" />
                <span className="sr-only">Remove</span>
              </Button>
            </form>
          )}
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={5} className="px-3 pb-2 text-xs text-red-700">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}
