// payroll.run.tick — fires on the automation.payrollRun.cron schedule.
// Creates a PayrollRun in SCHEDULED for the most recent (or current)
// open period and immediately enqueues `ngteco.import` against it.
//
// The full state machine (review/approve/publish) is wired in Phase 3.

import { logger } from "@/lib/telemetry";
import { ensureNextPeriod, getCurrentPeriod } from "@/lib/db/queries/pay-periods";
import { createRun } from "@/lib/db/queries/payroll-runs";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { getSetting } from "@/lib/settings/runtime";

function todayInTimezone(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

export async function handlePayrollRunTick(boss: {
  send: (name: string, data: object) => Promise<unknown>;
}): Promise<void> {
  const automation = await getSetting("automation");
  if (!automation.payrollRun.enabled) {
    logger.info("payroll.run.tick: disabled in settings; skipping");
    return;
  }
  const company = await getSetting("company");
  const today = todayInTimezone(company.timezone);
  await ensureNextPeriod(today);
  const period = await getCurrentPeriod(today);
  if (!period) {
    logger.warn("payroll.run.tick: no current period after ensure; skipping");
    return;
  }
  // The default tick fires on the weekly cron, so attach the WEEKLY pay
  // schedule to its run when one exists. Without this, weekly runs would
  // include semi-monthly employees too. Per-schedule crons are a future
  // refinement; this keeps the immediate cohort correct.
  const schedules = await listSchedules({ includeInactive: false });
  const weekly = schedules.find((s) => s.periodKind === "WEEKLY") ?? null;
  const run = await createRun(period.id, new Date(), null, {
    payScheduleId: weekly?.id ?? null,
  });
  logger.info(
    { runId: run.id, periodId: period.id, payScheduleId: weekly?.id ?? null },
    "payroll.run.tick: scheduled run",
  );
  await boss.send("ngteco.import", { runId: run.id });
}
