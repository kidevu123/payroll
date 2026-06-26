// payroll.run.tick — fires on the automation.payrollRun.cron schedule.
// Creates a PayrollRun in SCHEDULED for the most recent (or current)
// open period and immediately enqueues `ngteco.import` against it.
//
// The full state machine (review/approve/publish) is wired in Phase 3.

import { logger } from "@/lib/telemetry";
import { ensurePeriodForSchedule } from "@/lib/db/queries/pay-periods";
import type { PayPeriod } from "@/lib/db/schema";
import { createRun, getRunForPeriod } from "@/lib/db/queries/payroll-runs";
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
  // The default tick fires on the weekly cron, so it runs the WEEKLY cadence.
  // Use that schedule's own tagged period (and tag the run with it) so the run
  // never mixes in semi-monthly/monthly employees and never creates an orphan
  // untagged period. Falls back to the generic current period only when no
  // weekly schedule is configured.
  const schedules = await listSchedules({ includeInactive: false });
  const weekly = schedules.find((s) => s.periodKind === "WEEKLY") ?? null;
  let period: PayPeriod | null;
  if (weekly) {
    period = await ensurePeriodForSchedule(weekly.id, today, null);
  } else {
    // No weekly schedule configured — use the first active schedule's period
    // rather than creating an untagged ("UNASSIGNED") period. You run weekly,
    // so this branch never fires in practice.
    const fallback = schedules[0] ?? null;
    period = fallback
      ? await ensurePeriodForSchedule(fallback.id, today, null)
      : null;
  }
  if (!period) {
    logger.warn("payroll.run.tick: no current period after ensure; skipping");
    return;
  }
  // Idempotency: a duplicate tick fire (cron retry, double-schedule) must not
  // spin up a second run + ngteco.import for the same period. Reuse any
  // existing run unless the only one is CANCELLED/FAILED (then a fresh run is a
  // legitimate recovery).
  const existing = await getRunForPeriod(period.id);
  if (existing && existing.state !== "CANCELLED" && existing.state !== "FAILED") {
    logger.info(
      { runId: existing.id, periodId: period.id, state: existing.state },
      "payroll.run.tick: run already exists for period; skipping duplicate",
    );
    return;
  }
  const run = await createRun(period.id, new Date(), null, {
    payScheduleId: weekly?.id ?? null,
  });
  logger.info(
    { runId: run.id, periodId: period.id, payScheduleId: weekly?.id ?? null },
    "payroll.run.tick: scheduled run",
  );
  await boss.send("ngteco.import", { runId: run.id });
}
