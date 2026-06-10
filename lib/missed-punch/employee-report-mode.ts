import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
  isOpenShiftPunch,
} from "@/lib/punches/missing-punch";

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
      recordedClockIn?: never;
      recordedClockOut?: never;
      recordedUnpairedPunch?: never;
    };

function formatWallClock(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function toDatetimeLocalValue(d: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

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

  return {
    kind: "NO_PUNCH_OR_CORRECTION",
    defaultClockIn: `${args.date}T08:00`,
    defaultClockOut: "",
  };
}
