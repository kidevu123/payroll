// Period rollover. Idempotent: ensure an OPEN period exists for "today"
// in the company's configured timezone. Logged either way.
//
// Cron: 30 0 * * * (00:30 daily). Scheduled in lib/jobs/index.ts.

import { logger } from "@/lib/telemetry";
import { ensureNextPeriod } from "@/lib/db/queries/pay-periods";
import { getSetting } from "@/lib/settings/runtime";

function todayInTimezone(tz: string): string {
  // YYYY-MM-DD in the company TZ.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export async function runPeriodRollover(): Promise<{ created: boolean; periodId: string; startDate: string; endDate: string }> {
  const company = await getSetting("company");
  const today = todayInTimezone(company.timezone);
  const period = await ensureNextPeriod(today);
  const created = period.createdAt.getTime() > Date.now() - 60_000;
  logger.info(
    {
      periodId: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      created,
    },
    created
      ? "period.rollover: created period"
      : "period.rollover: existing period covers today",
  );
  return {
    created,
    periodId: period.id,
    startDate: period.startDate,
    endDate: period.endDate,
  };
}
