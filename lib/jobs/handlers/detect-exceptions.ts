// Phase 3 — payroll.run.detect-exceptions handler.
//
// Runs missed-punch detection for the run's period, then transitions the
// run to AWAITING_EMPLOYEE_FIXES or AWAITING_ADMIN_REVIEW.

import { logger } from "@/lib/telemetry";
import { getRun, transitionRun } from "@/lib/db/queries/payroll-runs";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listAlertsForPeriod } from "@/lib/db/queries/alerts";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { getSetting } from "@/lib/settings/runtime";
import { syncMissedPunchAlerts } from "@/lib/payroll/sync-missed-punch-alerts";
import { dispatch } from "@/lib/notifications/router";

export async function handleDetectExceptions(data: {
  runId: string;
}): Promise<void> {
  const { runId } = data;
  const run = await getRun(runId);
  if (!run) {
    logger.error({ runId }, "detect-exceptions: run not found");
    return;
  }
  const period = await getPeriodById(run.periodId);
  if (!period) {
    logger.error({ runId, periodId: run.periodId }, "detect-exceptions: period not found");
    return;
  }

  await syncMissedPunchAlerts({ periodId: period.id, runId });

  const automation = await getSetting("automation");
  const fixWindowHours = automation.employeeFixWindowHours;
  const hasUnresolved = await listAlertsForPeriod(period.id, { unresolvedOnly: true });
  if (hasUnresolved.length > 0) {
    const deadline = new Date(Date.now() + fixWindowHours * 60 * 60 * 1000);
    await transitionRun(runId, "AWAITING_EMPLOYEE_FIXES", null, {
      ingestCompletedAt: new Date(),
      employeeFixDeadline: deadline,
    });
    logger.info(
      { runId, alerts: hasUnresolved.length, fixWindowHours },
      "detect-exceptions: -> AWAITING_EMPLOYEE_FIXES",
    );
    return;
  }
  await transitionRun(runId, "AWAITING_ADMIN_REVIEW", null, {
    ingestCompletedAt: new Date(),
  });
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatch(
      admins.map((id) => ({
        recipientId: id,
        kind: "payroll_run.awaiting_review" as const,
        payload: { runId, periodId: period.id },
      })),
    );
  }
  logger.info({ runId }, "detect-exceptions: -> AWAITING_ADMIN_REVIEW");
}
