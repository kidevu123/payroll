"use client";

import * as React from "react";
import { ChevronUp, ChevronDown, Trash2, Plus } from "lucide-react";
import type { Shift } from "@/lib/db/schema";
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
import { ShiftChip } from "@/components/domain/shift-chip";
import {
  archiveShiftAction,
  createShiftAction,
  reorderShiftsAction,
  updateShiftAction,
} from "./actions";

export function ShiftsManager({ shifts }: { shifts: Shift[] }) {
  const [items, setItems] = React.useState(shifts);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    setItems(shifts);
  }, [shifts]);

  async function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= items.length) return;
    const reordered = [...items];
    const [a, b] = [reordered[idx]!, reordered[next]!];
    reordered[idx] = b;
    reordered[next] = a;
    setItems(reordered);
    setPending(true);
    setError(null);
    const result = await reorderShiftsAction(reordered.map((s) => s.id));
    setPending(false);
    if (result?.error) setError(result.error);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Shifts</CardTitle>
          <CardDescription>
            Reorder, edit color, archive (soft-delete). Single &quot;Day&quot; shift is
            seeded by default.
          </CardDescription>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add shift
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {creating && (
          <ShiftForm
            mode="create"
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              setError(null);
            }}
            onError={setError}
          />
        )}

        {items.length === 0 ? (
          <p className="text-sm text-[--text-muted]">
            No shifts yet. Add one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((s, i) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-[--radius-card] border border-[--border] bg-[--surface] p-3"
              >
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || pending}
                    className="rounded p-0.5 text-[--text-muted] hover:bg-[--surface-2] disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1 || pending}
                    className="rounded p-0.5 text-[--text-muted] hover:bg-[--surface-2] disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex-1">
                  {editingId === s.id ? (
                    <ShiftForm
                      mode="edit"
                      shift={s}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => {
                        setEditingId(null);
                        setError(null);
                      }}
                      onError={setError}
                    />
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <ShiftChip
                          name={s.name}
                          colorHex={s.colorHex}
                          archived={!!s.archivedAt}
                        />
                        {s.defaultStart || s.defaultEnd ? (
                          <span className="text-xs text-[--text-muted]">
                            {s.defaultStart ?? "—"} → {s.defaultEnd ?? "—"}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingId(s.id)}
                          disabled={!!s.archivedAt}
                        >
                          Edit
                        </Button>
                        {!s.archivedAt && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              const result = await archiveShiftAction(s.id);
                              if (result?.error) setError(result.error);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
  );
}

function ShiftForm({
  mode,
  shift,
  onCancel,
  onSaved,
  onError,
}: {
  mode: "create" | "edit";
  shift?: Shift;
  onCancel: () => void;
  onSaved: () => void;
  onError: (m: string | null) => void;
}) {
  const [pending, setPending] = React.useState(false);
  return (
    <form
      action={async (form) => {
        setPending(true);
        onError(null);
        const result =
          mode === "create"
            ? await createShiftAction(form)
            : await updateShiftAction(shift!.id, form);
        setPending(false);
        if (result?.error) onError(result.error);
        else onSaved();
      }}
      className="grid grid-cols-1 sm:grid-cols-[1fr_4rem_1fr_1fr_auto_auto] items-end gap-2"
    >
      <div className="space-y-1">
        <Label htmlFor={`name-${shift?.id ?? "new"}`}>Name</Label>
        <Input
          id={`name-${shift?.id ?? "new"}`}
          name="name"
          required
          defaultValue={shift?.name ?? ""}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`color-${shift?.id ?? "new"}`}>Color</Label>
        <Input
          id={`color-${shift?.id ?? "new"}`}
          name="colorHex"
          type="color"
          defaultValue={shift?.colorHex ?? "#0f766e"}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`start-${shift?.id ?? "new"}`}>Default start</Label>
        <Input
          id={`start-${shift?.id ?? "new"}`}
          name="defaultStart"
          type="time"
          defaultValue={shift?.defaultStart ?? ""}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`end-${shift?.id ?? "new"}`}>Default end</Label>
        <Input
          id={`end-${shift?.id ?? "new"}`}
          name="defaultEnd"
          type="time"
          defaultValue={shift?.defaultEnd ?? ""}
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
