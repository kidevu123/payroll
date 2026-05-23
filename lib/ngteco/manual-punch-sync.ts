export const NGTECO_MANUAL_PUNCH_SYNC_QUEUE = "ngteco.manual-punch.sync";

export type ManualPunchSyncJobData = {
  punchId: string;
  actorId: string;
  actorRole: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE";
};

export type ManualPunchSyncEvent = {
  kind: "clockIn" | "clockOut";
  punchAt: Date;
  personId: string;
  employeeName: string;
};

export function buildManualPunchSyncEvents(input: {
  punchId: string;
  personId: string | null;
  employeeName: string;
  clockIn: Date;
  clockOut: Date | null;
}): ManualPunchSyncEvent[] {
  if (!input.personId) {
    throw new Error(
      `Punch ${input.punchId} cannot sync to NGTeco: employee has no NGTeco ID.`,
    );
  }
  const events: ManualPunchSyncEvent[] = [
    {
      kind: "clockIn",
      punchAt: input.clockIn,
      personId: input.personId,
      employeeName: input.employeeName,
    },
  ];
  if (input.clockOut) {
    events.push({
      kind: "clockOut",
      punchAt: input.clockOut,
      personId: input.personId,
      employeeName: input.employeeName,
    });
  }
  return events;
}

export function formatNgtecoManualPunchTimestamp(
  punchAt: Date,
  timeZone: string,
): { date: string; time: string; timeZoneOffset: string } {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(punchAt);
  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(punchAt);
  const get = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get(dateParts, "month")}/${get(dateParts, "day")}/${get(dateParts, "year")}`;
  const time = `${get(timeParts, "hour")}:${get(timeParts, "minute")}:${get(timeParts, "second")}`;
  const offset = offsetForTimeZone(punchAt, timeZone);
  return { date, time, timeZoneOffset: offset };
}

function offsetForTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const raw =
    parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-04:00";
  const match = /^GMT([+-]\d{2}):?(\d{2})$/.exec(raw);
  if (!match) return "-04:00";
  return `${match[1]}:${match[2]}`;
}
