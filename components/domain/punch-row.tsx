// Single-punch row. Shows date, in/out, hours, edit indicator. Used in
// the Time tab grid drill-down and the Employee detail's Punches tab.

import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Punch } from "@/lib/db/schema";
import { HoursDisplay } from "./hours-display";
import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import { coerceDate } from "@/lib/time/wall-clock";

const MS_PER_HOUR = 60 * 60 * 1000;

function formatClock(d: Date | string | null, timezone: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(coerceDate(d));
}

function formatDay(d: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(coerceDate(d));
}

function durationHours(p: Punch): number {
  if (isMissingClockInPunch(p)) return 0;
  if (!p.clockOut) return 0;
  return Math.max(
    0,
    (coerceDate(p.clockOut).getTime() - coerceDate(p.clockIn).getTime()) /
      MS_PER_HOUR,
  );
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
  const ambiguous = isAmbiguousSinglePunch(punch);
  const missingIn = isMissingClockInPunch(punch);
  const openShift = isOpenShiftPunch(punch);
  return (
    <div
      className={cn(
        // Phone: the day sits on its own line, then in – out with the hours
        // right-aligned, then any actions full-width. The six fixed desktop
        // tracks (10rem day column + two auto columns) cannot fit 390px and
        // pushed the action buttons off the screen.
        "grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 sm:grid-cols-[10rem_1fr_1fr_4rem_auto_auto] sm:gap-3 rounded-input border border-border bg-surface px-3 py-2.5 text-sm",
        punch.voidedAt && "opacity-50 line-through",
        (missingIn || ambiguous) && "border-warning-200/80 bg-warning-50/40",
        className,
      )}
    >
      <div className="text-text-muted max-sm:col-span-3 max-sm:text-xs">{formatDay(punch.clockIn, timezone)}</div>
      <div className="tabular-nums">
        {ambiguous ? (
          <span className="text-warning-800 text-micro uppercase">
            Unpaired
          </span>
        ) : missingIn ? (
          <span className="text-warning-800 text-micro uppercase">
            Missing in
          </span>
        ) : (
          formatClock(punch.clockIn, timezone)
        )}
      </div>
      <div className="tabular-nums">
        <span aria-hidden className="mr-2 text-text-subtle sm:hidden">–</span>
        {ambiguous ? (
          <span className="tabular-nums text-warning-900">
            {formatClock(punch.clockIn, timezone)}
          </span>
        ) : openShift ? (
          <span className="text-warning-700 text-xs font-medium">open</span>
        ) : (
          formatClock(punch.clockOut, timezone)
        )}
      </div>
      {missingIn || ambiguous ? (
        <span className="text-micro uppercase text-warning-800 max-sm:justify-self-end">
          fix
        </span>
      ) : (
        <HoursDisplay
          hours={durationHours(punch)}
          decimals={decimals}
          className="max-sm:justify-self-end max-sm:font-medium"
        />
      )}
      <div className="flex items-center gap-1 text-xs text-text-muted max-sm:col-span-3 max-sm:empty:hidden">
        {edited ? (
          <>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            edited
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-2 justify-self-end max-sm:col-span-3 max-sm:justify-self-stretch max-sm:empty:hidden">{rightSlot}</div>
    </div>
  );
}
