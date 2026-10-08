// Labels and small formatters for the pay-period detail page. Moved out of
// app/(admin)/payroll/[periodId]/page.tsx so they can be tested.

export function formatHm(d: Date | null, tz: string): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(dt);
}

export function formatDayLabel(dateIso: string, tz: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(d);
}

export function rateLabel(employee: {
  payType: string;
  hourlyRateCents: number | null;
}): string {
  if (employee.payType === "FLAT_TASK") {
    return `Per task · ${
      employee.hourlyRateCents !== null
        ? `$${(employee.hourlyRateCents / 100).toFixed(2)}`
        : "—"
    }`;
  }
  return employee.hourlyRateCents !== null
    ? `$${(employee.hourlyRateCents / 100).toFixed(2)}/hr`
    : "—";
}

export function formatShortDate(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
  }).format(d instanceof Date ? d : new Date(d));
}

/** Inclusive day count between two ISO dates. */
export function periodDayCount(startIso: string, endIso: string): number {
  const a = Date.UTC(
    Number(startIso.slice(0, 4)),
    Number(startIso.slice(5, 7)) - 1,
    Number(startIso.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(endIso.slice(0, 4)),
    Number(endIso.slice(5, 7)) - 1,
    Number(endIso.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000) + 1;
}

export const ROUNDING_LABEL: Record<string, string> = {
  NONE: "Pay is not rounded",
  NEAREST_DOLLAR: "Pay is rounded to the nearest dollar",
  NEAREST_QUARTER: "Pay is rounded to the nearest quarter",
  NEAREST_FIFTEEN_MIN_HOURS: "Hours are rounded to the nearest 15 minutes",
};
