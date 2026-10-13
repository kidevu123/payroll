import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";
import { formatWallClock, toDatetimeLocalValue } from "@/lib/time/format";

type PunchLike = {
  clockIn: Date;
  clockOut: Date | null;
  notes?: string | null;
  voidedAt?: Date | null;
};

export type EmployeeReportFixMode =
  | {
      kind: "MISSING_OUT";
      recordedClockIn: string;
      defaultClockOut: string;
      defaultClockIn?: never;
      recordedClockOut?: never;
      recordedUnpairedPunch?: never;
    }
  | {
      kind: "MISSING_IN";
      recordedClockOut: string;
      defaultClockIn: string;
      defaultClockOut?: never;
      recordedClockIn?: never;
      recordedUnpairedPunch?: never;
    }
  | {
      kind: "UNPAIRED_PUNCH";
      recordedUnpairedPunch: string;
      defaultClockIn: string;
      defaultClockOut: string;
      recordedClockIn?: never;
      recordedClockOut?: never;
    }
  | {
      kind: "NO_PUNCH_OR_CORRECTION";
      defaultClockIn: string;
      defaultClockOut: string;
      /**
       * Set when the day already has one completed shift: the form is then a
       * correction of these times and starts from them. Absent = no hours on
       * file (or several punches), so the employee enters the day fresh.
       */
      onFileShift?: { clockIn: string; clockOut: string };
      recordedClockIn?: never;
      recordedClockOut?: never;
      recordedUnpairedPunch?: never;
    };

export function buildEmployeeReportFixMode(args: {
  date: string;
  timezone: string;
  punches: PunchLike[];
}): EmployeeReportFixMode {
  const active = args.punches.filter((p) => !p.voidedAt);
  const open = active.find((p) => isOpenShiftPunch(p));
  if (open) {
    return {
      kind: "MISSING_OUT",
      recordedClockIn: formatWallClock(open.clockIn, args.timezone),
      defaultClockOut: toDatetimeLocalValue(
        new Date(open.clockIn.getTime() + 8 * 60 * 60 * 1000),
        args.timezone,
      ),
    };
  }

  const missingIn = active.find((p) => isMissingClockInPunch(p));
  if (missingIn?.clockOut) {
    return {
      kind: "MISSING_IN",
      recordedClockOut: formatWallClock(missingIn.clockOut, args.timezone),
      defaultClockIn: `${args.date}T08:00`,
    };
  }

  const unpaired = active.find((p) => isAmbiguousSinglePunch(p));
  if (unpaired) {
    return {
      kind: "UNPAIRED_PUNCH",
      recordedUnpairedPunch: formatWallClock(unpaired.clockIn, args.timezone),
      defaultClockIn: `${args.date}T08:00`,
      defaultClockOut: `${args.date}T17:00`,
    };
  }

  // One completed shift on file: the employee is correcting it, so start the
  // form from what the clock recorded instead of a made-up 8:00.
  const completed = active.filter(
    (p) => p.clockOut && p.clockOut.getTime() > p.clockIn.getTime(),
  );
  if (active.length === 1 && completed.length === 1) {
    const shift = completed[0]!;
    return {
      kind: "NO_PUNCH_OR_CORRECTION",
      defaultClockIn: toDatetimeLocalValue(shift.clockIn, args.timezone),
      defaultClockOut: toDatetimeLocalValue(shift.clockOut!, args.timezone),
      onFileShift: {
        clockIn: formatWallClock(shift.clockIn, args.timezone),
        clockOut: formatWallClock(shift.clockOut!, args.timezone),
      },
    };
  }

  return {
    kind: "NO_PUNCH_OR_CORRECTION",
    defaultClockIn: `${args.date}T08:00`,
    defaultClockOut: "",
  };
}
