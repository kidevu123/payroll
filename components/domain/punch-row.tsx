// Single-punch row. Shows date, in/out, hours, edit indicator. Used in
// the Time tab grid drill-down and the Employee detail's Punches tab.

import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Punch } from "@/lib/db/schema";
import { HoursDisplay } from "./hours-display";

const MS_PER_HOUR = 60 * 60 * 1000;

function formatClock(d: Date | null, timezone: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(d);
}

function formatDay(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(d);
}

function durationHours(p: Punch): number {
  if (!p.clockOut) return 0;
  return Math.max(0, (p.clockOut.getTime() - p.clockIn.getTime()) / MS_PER_HOUR);
}

export function PunchRow({
  punch,
  timezone,
  decimals = 2,
  className,
  rightSlot,
}: {
  punch: Punch;
  timezone: string;
  decimals?: number;
  className?: string;
  rightSlot?: React.ReactNode;
}) {
  const edited = !!punch.editedAt;
  return (
    <div
      className={cn(
        "grid grid-cols-[10rem_1fr_1fr_4rem_auto_auto] items-center gap-3 rounded-[--radius-card] border border-[--border] bg-[--surface] px-3 py-2 text-sm",
        punch.voidedAt && "opacity-50 line-through",
        className,
      )}
    >
      <div className="text-[--text-muted]">{formatDay(punch.clockIn, timezone)}</div>
      <div className="font-mono tabular-nums">{formatClock(punch.clockIn, timezone)}</div>
      <div className="font-mono tabular-nums">{formatClock(punch.clockOut, timezone)}</div>
      <HoursDisplay hours={durationHours(punch)} decimals={decimals} />
      <div className="flex items-center gap-1 text-xs text-[--text-muted]">
        {edited ? (
          <>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            edited
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-2 justify-self-end">{rightSlot}</div>
    </div>
  );
}
