// payroll.run.fix-window-expire — scheduled by detect-exceptions when a
// run enters AWAITING_EMPLOYEE_FIXES. When the deadline passes (whether
// or not all alerts are resolved), the run advances to
// AWAITING_ADMIN_REVIEW so Sunday-night payroll can't stall indefinitely
// on an absent employee.

import { logger } from "@/lib/telemetry";
import { getRun, transitionRun } from "@/lib/db/queries/payroll-runs";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatchInApp } from "@/lib/notifications/in-app";

export async function handleFixWindowExpire(data: { runId: string }): Promise<void> {
  const { runId } = data;
  const run = await getRun(runId);
  if (!run) {
    logger.error({ runId }, "fix-window-expire: run not found");
    return;
  }
  if (run.state !== "AWAITING_EMPLOYEE_FIXES") {
    logger.info(
      { runId, state: run.state },
      "fix-window-expire: not in AWAITING_EMPLOYEE_FIXES; nothing to do",
    );
    return;
  }
  await transitionRun(runId, "AWAITING_ADMIN_REVIEW", null, {});
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatchInApp(
      admins.map((id) => ({
        recipientId: id,
        kind: "payroll_run.awaiting_review",
        payload: { runId, reason: "employee fix window expired" },
      })),
    );
  }
  logger.info({ runId }, "fix-window-expire: -> AWAITING_ADMIN_REVIEW");
}
