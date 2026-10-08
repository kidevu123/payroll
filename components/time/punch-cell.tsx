// The content of one employee-day cell in the desktop /time grid: a dash for
// empty states, a label chip for time off, a two-line pill for punches.
import { isAmbiguousSinglePunch, isMissingClockInPunch } from "@/lib/punches/missing-punch";
import {
  cellPillClasses,
  timeOffLabel,
  type CellState,
  type PunchLite,
} from "@/lib/time-grid/cell-state";
import { formatHoursMinutes, formatTimeShort } from "@/lib/utils";

export function PunchCell({
  state,
  first,
  last,
  count,
  hours,
  tz,
}: {
  state: CellState;
  first: PunchLite | undefined;
  last: PunchLite | undefined;
  count: number;
  hours: number;
  tz: string;
}) {
  // Empty / non-data states: just a dash character with color.
  if (state === "future") {
    return <span className="text-border-strong text-[11px] select-none">—</span>;
  }
  if (state === "inactive") {
    return <span className="text-text-subtle/30 text-[11px] select-none">—</span>;
  }
  if (state === "missed") {
    return <span className="text-danger-500 text-body font-medium">—</span>;
  }

  // Time-off label: compact uppercase badge. min-h matches the two-line
  // data pills (px-2 py-1 + two text rows) so pill heights stay even
  // across a grid row instead of this single-line chip sitting short.
  if (state === "pto" || state === "sick" || state === "unpaid" || state === "other") {
    return (
      <span className={`inline-flex min-h-[2.25rem] items-center justify-center rounded-[5px] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${cellPillClasses(state)}`}>
        {timeOffLabel(state)}
      </span>
    );
  }

  // Data states (complete / incomplete): pill with time range + duration.
  if (!first) return <span className="text-border-strong text-[11px]">—</span>;
  if (state === "incomplete" && last && isAmbiguousSinglePunch(last)) {
    const punchLabel = formatTimeShort(last.clockIn, tz);
    return (
      <span
        className={`inline-flex flex-col items-center gap-0 rounded-[6px] px-2 py-1 w-full max-w-[108px] mx-auto leading-snug ${cellPillClasses(state)}`}
      >
        <span className="text-micro uppercase">
          Unpaired
        </span>
        <span className="tabular-nums text-[10px] font-semibold whitespace-nowrap">
          {punchLabel}
        </span>
      </span>
    );
  }
  if (state === "incomplete" && last && isMissingClockInPunch(last)) {
    const outLabel = last.clockOut
      ? formatTimeShort(last.clockOut, tz)
      : "open";
    return (
      <span
        className={`inline-flex flex-col items-center gap-0 rounded-[6px] px-2 py-1 w-full max-w-[108px] mx-auto leading-snug ${cellPillClasses(state)}`}
      >
        <span className="text-micro uppercase">
          Missing in
        </span>
        <span className="tabular-nums text-[10px] font-semibold whitespace-nowrap">
          out {outLabel}
        </span>
      </span>
    );
  }
  const inLabel = formatTimeShort(first.clockIn, tz);
  const outLabel = last && last.clockOut ? formatTimeShort(last.clockOut, tz) : "open";
  return (
    <span
      className={`inline-flex flex-col items-center gap-0 rounded-[6px] px-2 py-1 w-full max-w-[108px] mx-auto leading-snug transition-all hover:brightness-95 ${cellPillClasses(state)}`}
    >
      <span className="tabular-nums text-[10px] font-semibold whitespace-nowrap">
        {inLabel}
        <span className="opacity-40 mx-0.5">&ndash;</span>
        {outLabel}
        {count > 1 ? <span className="ml-0.5 text-[11px] opacity-60">+{count - 1}</span> : null}
      </span>
      <span className="text-[11px] font-medium opacity-65">
        {state === "incomplete" ? "in progress" : formatHoursMinutes(hours)}
      </span>
    </span>
  );
}
