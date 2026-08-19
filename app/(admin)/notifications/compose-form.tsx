"use client";

import * as React from "react";
import { Send, Users, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  previewAnnouncementAction,
  sendAnnouncementAction,
} from "./actions";

type EmployeeOpt = {
  id: string;
  displayName: string;
  payType: string;
};

type Mode = "ALL" | "BY_ROLE" | "BY_SCHEDULE" | "SPECIFIC";

const PAY_TYPE_LABELS: Record<string, string> = {
  HOURLY: "Hourly",
  SALARIED: "Salaried",
  TASK: "Task pay",
  MIXED: "Mixed",
};

export function ComposeAnnouncementForm({
  employees,
  initial,
}: {
  employees: EmployeeOpt[];
  /** Pre-fill from a saved template (/notifications/new?template=<id>). */
  initial?: { title: string; body: string; link: string | null };
}) {
  const [mode, setMode] = React.useState<Mode>("ALL");
  const [payTypes, setPayTypes] = React.useState<Set<string>>(new Set());
  const [periodKinds, setPeriodKinds] = React.useState<Set<string>>(new Set());
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [filterText, setFilterText] = React.useState("");
  const [count, setCount] = React.useState<number | null>(null);
  const [previewing, setPreviewing] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Re-preview the recipient count on every audience change. Debounced
  // 300ms so a flurry of toggles doesn't hammer the server.
  React.useEffect(() => {
    const handle = setTimeout(async () => {
      setPreviewing(true);
      const r = await previewAnnouncementAction({
        mode,
        payTypes: Array.from(payTypes),
        periodKinds: Array.from(periodKinds),
        employeeIds: Array.from(selected),
      });
      setPreviewing(false);
      if ("error" in r) setCount(null);
      else setCount(r.count);
    }, 300);
    return () => clearTimeout(handle);
  }, [mode, payTypes, periodKinds, selected]);

  const filtered = React.useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      e.displayName.toLowerCase().includes(q),
    );
  }, [filterText, employees]);

  return (
    <form
      action={async (form) => {
        setPending(true);
        setError(null);
        // Make sure the form payload reflects component state — a few
        // of our inputs are derived (Set<string>) so we need to push
        // them in explicitly.
        form.delete("payTypes");
        form.delete("periodKinds");
        form.delete("employeeIds");
        if (mode === "BY_ROLE") {
          payTypes.forEach((p) => form.append("payTypes", p));
        }
        if (mode === "BY_SCHEDULE") {
          periodKinds.forEach((k) => form.append("periodKinds", k));
        }
        if (mode === "SPECIFIC") {
          selected.forEach((id) => form.append("employeeIds", id));
        }
        form.set("mode", mode);
        const r = await sendAnnouncementAction(form);
        setPending(false);
        if (r?.error) setError(r.error);
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          maxLength={200}
          defaultValue={initial?.title}
          placeholder="e.g. Office closed Friday for inventory"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="body">Message</Label>
        <textarea
          id="body"
          name="body"
          required
          rows={5}
          maxLength={2000}
          defaultValue={initial?.body}
          placeholder="What do you want to tell them?"
          className="w-full rounded-input border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="link">Optional link</Label>
        <Input
          id="link"
          name="link"
          maxLength={500}
          defaultValue={initial?.link ?? undefined}
          placeholder="/me/calendar  (or  https://...)"
        />
        <p className="text-[11px] text-text-muted">
          Tapping the notification opens this URL. Leave blank for a
          plain message.
        </p>
      </div>

      <div className="space-y-2 rounded-card border border-border bg-surface-2/40 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4 text-text-muted" /> Audience
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ModeChip
            label="All employees"
            active={mode === "ALL"}
            onClick={() => setMode("ALL")}
          />
          <ModeChip
            label="By role"
            active={mode === "BY_ROLE"}
            onClick={() => setMode("BY_ROLE")}
          />
          <ModeChip
            label="By schedule"
            active={mode === "BY_SCHEDULE"}
            onClick={() => setMode("BY_SCHEDULE")}
          />
          <ModeChip
            label="Specific employees"
            active={mode === "SPECIFIC"}
            onClick={() => setMode("SPECIFIC")}
          />
        </div>

        {mode === "BY_ROLE" && (
          <div className="flex flex-wrap gap-1.5">
            {(["HOURLY", "SALARIED", "TASK", "MIXED"] as const).map((p) => (
              <ToggleChip
                key={p}
                label={PAY_TYPE_LABELS[p] ?? p}
                active={payTypes.has(p)}
                onClick={() =>
                  setPayTypes((prev) => toggleSet(prev, p))
                }
              />
            ))}
          </div>
        )}

        {mode === "BY_SCHEDULE" && (
          <div className="flex flex-wrap gap-1.5">
            {(["WEEKLY", "SEMI_MONTHLY", "MONTHLY"] as const).map((k) => (
              <ToggleChip
                key={k}
                label={
                  k === "WEEKLY"
                    ? "Weekly"
                    : k === "SEMI_MONTHLY"
                      ? "Semi-monthly"
                      : "Monthly"
                }
                active={periodKinds.has(k)}
                onClick={() =>
                  setPeriodKinds((prev) => toggleSet(prev, k))
                }
              />
            ))}
          </div>
        )}

        {mode === "SPECIFIC" && (
          <div className="space-y-2">
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter by name…"
              className="text-sm"
            />
            <div className="max-h-56 overflow-y-auto rounded-input border border-border bg-surface">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-text-muted">
                  No matches.
                </div>
              ) : (
                filtered.map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-surface-2/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() =>
                        setSelected((prev) => toggleSet(prev, e.id))
                      }
                      className="h-4 w-4"
                    />
                    <span className="flex-1 truncate">{e.displayName}</span>
                    <span className="text-micro uppercase text-text-subtle">
                      {e.payType}
                    </span>
                  </label>
                ))
              )}
            </div>
            {selected.size > 0 && (
              <p className="text-[11px] text-text-muted">
                {selected.size} selected
              </p>
            )}
          </div>
        )}

        <div className="rounded-input border border-success-200 bg-success-50 px-3 py-2 text-xs text-success-900">
          {previewing
            ? "Counting…"
            : count === null
              ? "Pick an audience to preview reach."
              : count === 0
                ? "No one matches that filter yet — pick a wider audience or invite the missing employees first."
                : `This will reach ${count} ${count === 1 ? "person" : "people"} (in-app + Web Push for those who opted in).`}
        </div>
      </div>

      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" disabled={pending || (count ?? 0) === 0}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" /> Send announcement
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function ModeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-chip border text-xs font-medium transition-colors ${
        active
          ? "border-brand-700 bg-brand-700 text-brand-fg"
          : "border-border bg-surface text-text-muted hover:bg-surface-2/40"
      }`}
    >
      {label}
    </button>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-input border text-xs font-medium transition-colors ${
        active
          ? "border-brand-700 bg-brand-50 text-brand-700"
          : "border-border bg-surface text-text-muted hover:bg-surface-2/40"
      }`}
    >
      {label}
    </button>
  );
}

function toggleSet<T>(prev: Set<T>, value: T): Set<T> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
