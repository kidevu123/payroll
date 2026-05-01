"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "null";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function diffKeys(before: unknown, after: unknown): string[] {
  if (
    before === null ||
    after === null ||
    typeof before !== "object" ||
    typeof after !== "object"
  ) {
    return [];
  }
  const keys = new Set<string>();
  for (const k of Object.keys(before as Record<string, unknown>)) keys.add(k);
  for (const k of Object.keys(after as Record<string, unknown>)) keys.add(k);
  const changed: string[] = [];
  for (const k of keys) {
    const b = (before as Record<string, unknown>)[k];
    const a = (after as Record<string, unknown>)[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) changed.push(k);
  }
  return changed;
}

export function AuditRowDiff({
  when,
  action,
  targetType,
  targetId,
  actorRole,
  actorId,
  ip,
  before,
  after,
}: {
  when: string;
  action: string;
  targetType: string;
  targetId: string;
  actorRole: string | null;
  actorId: string | null;
  ip: string | null;
  before: unknown;
  after: unknown;
}) {
  const [open, setOpen] = React.useState(false);
  const hasPayload = before !== null || after !== null;
  const changed = hasPayload ? diffKeys(before, after) : [];
  return (
    <div className="rounded-[--radius-card] border border-[--border] bg-[--surface]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!hasPayload}
        className={cn(
          "w-full flex items-start gap-3 p-3 text-left text-xs",
          hasPayload ? "hover:bg-[--surface-2]" : "opacity-90 cursor-default",
        )}
      >
        <span className="shrink-0 text-[--text-muted]">
          {hasPayload ? (
            open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <span className="block h-4 w-4" />
          )}
        </span>
        <span className="font-mono text-[11px] text-[--text-muted] w-44 shrink-0">{when}</span>
        <span className="font-medium w-48 shrink-0 truncate">{action}</span>
        <span className="flex-1 truncate">
          {targetType}
          <span className="ml-1 text-[--text-muted]">{targetId}</span>
        </span>
        <span className="w-32 shrink-0 truncate text-[--text-muted]">
          {actorRole ?? "—"}
          {actorId ? ` ${actorId.slice(0, 8)}…` : ""}
        </span>
        <span className="w-24 shrink-0 truncate text-[--text-muted]">{ip ?? "—"}</span>
        {changed.length > 0 ? (
          <span className="rounded bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5">
            {changed.length} change{changed.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </button>
      {open && hasPayload && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-[--border] p-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[--text-muted] mb-1">
              Before
            </div>
            <pre className="text-[11px] bg-[--surface-2] rounded p-2 overflow-auto max-h-72">
              {fmt(before)}
            </pre>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[--text-muted] mb-1">
              After
            </div>
            <pre className="text-[11px] bg-[--surface-2] rounded p-2 overflow-auto max-h-72">
              {fmt(after)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
