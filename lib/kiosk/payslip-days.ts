// Day-by-day punch rows for one payslip, shown above the Sign button so
// the employee sees exactly what they are signing for. Shared by the
// kiosk pay card, the self-serve signing page and the payday signing page.

import { listPunches } from "@/lib/db/queries/punches";
import { companyDayIso } from "@/lib/time/company-day";
import { addDaysIso, localMidnightUtc } from "@/lib/utils";

export type PayslipDayRow = {
  /** Company-local ISO date. */
  day: string;
  in: string;
  out: string | null;
  hours: number;
};

export async function loadPayslipDays(args: {
  employeeId: string;
  periodId: string;
  period: { startDate: string; endDate: string } | null | undefined;
  tz: string;
  locale: string;
}): Promise<PayslipDayRow[]> {
  const { employeeId, periodId, period, tz, locale } = args;
  const fmtTime = (d: Date) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  // Union of period-linked and date-range punches: legacy imports can
  // sit under a sibling schedule's overlapping period id (the /time
  // grid fetches by date range for the same reason), while back-pay
  // punches carry this period's id but an out-of-range date. Both
  // belong on the card the employee is signing.
  const byPeriod = await listPunches({ employeeId, periodId });
  const byRange = period
    ? await listPunches({
        employeeId,
        clockAfter: localMidnightUtc(period.startDate, tz),
        clockBefore: new Date(
          localMidnightUtc(addDaysIso(period.endDate, 1), tz).getTime() - 1,
        ),
      })
    : [];
  const seen = new Set<string>();
  return [...byPeriod, ...byRange]
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime())
    .filter((p) => !p.voidedAt)
    .map((p) => ({
      day: companyDayIso(p.clockIn, tz),
      in: fmtTime(p.clockIn),
      out: p.clockOut ? fmtTime(p.clockOut) : null,
      hours: p.clockOut
        ? (p.clockOut.getTime() - p.clockIn.getTime()) / 3_600_000
        : 0,
    }));
}
