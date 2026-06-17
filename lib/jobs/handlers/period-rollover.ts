// Period rollover. Idempotent: ensure the current OPEN period exists for each
// active pay schedule (Weekly / Semi-monthly / Monthly), in the company's
// configured timezone. So every cadence always has its current period without
// anyone creating or assigning one by hand.
//
// Previously this created a SINGLE UNTAGGED period (ensureNextPeriod), which
// duplicated the per-schedule periods the punch importer already creates via
// ensurePeriodForSchedule — surfacing as orphan "UNASSIGNED" rows that then
// couldn't be assigned (unique-date collision). Creating one tagged period per
// schedule here makes the daily job consistent with the importer and kills the
// orphan source.
//
// Cron: 30 0 * * * (00:30 daily). Scheduled in lib/jobs/index.ts.

import { logger } from "@/lib/telemetry";
import { ensurePeriodForSchedule } from "@/lib/db/queries/pay-periods";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { getSetting } from "@/lib/settings/runtime";

function todayInTimezone(tz: string): string {
  // YYYY-MM-DD in the company TZ.
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export async function runPeriodRollover(): Promise<{
  schedulesProcessed: number;
  periodsCreated: number;
}> {
  const company = await getSetting("company");
  const today = todayInTimezone(company.timezone);
  const schedules = await listSchedules(); // active only
  let periodsCreated = 0;
  for (const s of schedules) {
    const period = await ensurePeriodForSchedule(s.id, today, null);
    const wasCreated = period.createdAt.getTime() > Date.now() - 60_000;
    if (wasCreated) periodsCreated++;
    logger.info(
      {
        scheduleId: s.id,
        scheduleName: s.name,
        periodId: period.id,
        startDate: period.startDate,
        endDate: period.endDate,
        created: wasCreated,
      },
      wasCreated
        ? "period.rollover: created period for schedule"
        : "period.rollover: existing period covers today for schedule",
    );
  }
  return { schedulesProcessed: schedules.length, periodsCreated };
}
