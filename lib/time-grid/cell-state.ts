// What state is one employee-day cell in, and how is it labelled. This is THE
// rule the /time desktop grid, the phone attendance list and the day strip all
// share; it used to be written out three times inside the page.
import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import { formatTimeShort } from "@/lib/utils";

export type TimeOffType = "UNPAID" | "SICK" | "PERSONAL" | "OTHER";
export type PunchLite = { clockIn: Date; clockOut: Date | null };

export type CellState =
  | "complete"
  | "incomplete"
  | "missed"   // past day with no punch — genuinely absent
  | "future"   // day hasn't happened yet — no punch expected
  | "inactive"
  | "pto"      // approved PERSONAL / paid time off
  | "sick"     // approved SICK
  | "unpaid"   // approved UNPAID
  | "other";   // approved OTHER

// Background + text for cells that show a filled chip (data cells).
export function cellPillClasses(state: CellState): string {
  switch (state) {
    case "complete":
      return "bg-success-50 text-success-800";
    case "incomplete":
      return "bg-warning-50 text-warning-800";
    case "pto":
      return "bg-success-100/80 text-success-900";
    case "sick":
      return "bg-warning-100/80 text-warning-900";
    case "unpaid":
      return "bg-surface-2 text-text-muted";
    case "other":
      return "bg-info-50 text-info-800";
    default:
      return "";
  }
}

// Dot color for the legend.
export function legendDotClass(state: CellState): string {
  switch (state) {
    case "complete":
      return "bg-success-500";
    case "incomplete":
      return "bg-warning-500";
    case "missed":
      return "bg-danger-500";
    case "pto":
      return "bg-success-500";
    default:
      return "bg-border-strong";
  }
}

// Mobile attendance-list status badge label + dash-palette color per state.
export const MOBILE_STATUS: Record<CellState, { label: string; color: string }> = {
  complete: { label: "Complete", color: "var(--dash-emerald)" },
  incomplete: { label: "Unpaired", color: "var(--dash-amber)" },
  missed: { label: "Missing", color: "var(--dash-rose)" },
  future: { label: "—", color: "var(--dash-text-faint)" },
  inactive: { label: "Inactive", color: "var(--dash-text-faint)" },
  pto: { label: "PTO", color: "var(--dash-blue)" },
  sick: { label: "Sick", color: "var(--dash-blue)" },
  unpaid: { label: "Unpaid", color: "var(--dash-text-faint)" },
  other: { label: "Time off", color: "var(--dash-blue)" },
};

export function timeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function timeOffStateFor(
  type: TimeOffType,
): CellState {
  switch (type) {
    case "PERSONAL":
      return "pto";
    case "SICK":
      return "sick";
    case "UNPAID":
      return "unpaid";
    case "OTHER":
      return "other";
  }
}

export function timeOffLabel(state: CellState): string {
  switch (state) {
    case "pto":
      return "PTO";
    case "sick":
      return "Sick";
    case "unpaid":
      return "Unpaid";
    case "other":
      return "Off";
    default:
      return "";
  }
}

/**
 * The per-cell rule. Precedence: an inactive employee beats everything;
 * otherwise punches beat approved time off (the day was worked after all);
 * with no punches, time off beats "future", which beats "missed".
 */
export function cellStateFor(args: {
  punches: PunchLite[];
  offType: TimeOffType | undefined;
  dayIso: string;
  today: string;
  employeeActive: boolean;
}): CellState {
  const { punches, offType, dayIso, today, employeeActive } = args;
  let state: CellState;
  if (punches.length === 0) {
    if (offType) state = timeOffStateFor(offType);
    else if (dayIso > today) state = "future";
    else state = "missed";
  } else if (
    punches.some(
      (p) =>
        isAmbiguousSinglePunch(p) ||
        isMissingClockInPunch(p) ||
        isOpenShiftPunch(p),
    )
  ) {
    state = "incomplete";
  } else state = "complete";
  if (!employeeActive) state = "inactive";
  return state;
}

/** Punches sorted by clock-in, plus the duration of the closed ones. */
export function summarizeCell<T extends PunchLite>(
  punches: T[],
): { sorted: T[]; closedMs: number } {
  const sorted = [...punches].sort(
    (a, b) => a.clockIn.getTime() - b.clockIn.getTime(),
  );
  const closedMs = sorted.reduce(
    (acc, p) =>
      p.clockOut ? acc + (p.clockOut.getTime() - p.clockIn.getTime()) : acc,
    0,
  );
  return { sorted, closedMs };
}

export function cellAriaLabel(state: CellState, list: PunchLite[], tz: string): string {
  if (state === "inactive") return "Inactive employee";
  if (state === "pto") return "Approved time off — PTO";
  if (state === "sick") return "Approved time off — Sick";
  if (state === "unpaid") return "Approved time off — Unpaid";
  if (state === "other") return "Approved time off";
  if (list.length === 0) return "No punches — missed day";
  const lines = list.map((p) => {
    const inS = formatTimeShort(p.clockIn, tz);
    const outS = p.clockOut ? formatTimeShort(p.clockOut, tz) : "still open";
    return `${inS} to ${outS}`;
  });
  return lines.join("; ");
}

/** Everything the grid needs to render one employee-day cell. */
export type GridCell = {
  state: CellState;
  sorted: PunchLite[];
  closedMs: number;
  /** Period the day editor should open under, or null when there is none. */
  cellPeriodId: string | null;
};

/** One row of the phone attendance list: a cell plus whose it is. */
export type GridRow = GridCell & { e: { id: string; displayName: string } };

export function cellKey(employeeId: string, dayIso: string): string {
  return `${employeeId}|${dayIso}`;
}

