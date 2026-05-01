// Phase 3 — payroll.run.detect-exceptions handler.
//
// Reads punches + employees + holidays + approved time-off for the period,
// runs detectExceptions (pure), persists alerts, dispatches missed-punch
// notifications, and transitions the run to AWAITING_EMPLOYEE_FIXES (if
// alerts) or AWAITING_ADMIN_REVIEW.

import { logger } from "@/lib/telemetry";
import { getRun, transitionRun } from "@/lib/db/queries/payroll-runs";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listHolidaysInRange } from "@/lib/db/queries/holidays";
import { listApprovedTimeOffInRange } from "@/lib/db/queries/time-off";
import { listAlertsForPeriod, createAlerts } from "@/lib/db/queries/alerts";
import {
  userIdsForEmployees,
  adminUserIds,
} from "@/lib/db/queries/recipients";
import { getSetting } from "@/lib/settings/runtime";
import { detectExceptions } from "@/lib/payroll/detect-exceptions";
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
  // Match the cohort that publish will use — otherwise we'd flag missing
  // punches for employees who aren't actually part of this run.
  const employeeFilter = run.payScheduleId
    ? { payScheduleId: run.payScheduleId }
    : {};
  const [
    employees,
    punches,
    holidays,
    timeOff,
    payPeriod,
    automation,
    company,
  ] = await Promise.all([
    listEmployees(employeeFilter),
    listPunches({ periodId: period.id }),
    listHolidaysInRange(period.startDate, period.endDate),
    listApprovedTimeOffInRange(period.startDate, period.endDate),
    getSetting("payPeriod"),
    getSetting("automation"),
    getSetting("company"),
  ]);

  const detected = detectExceptions({
    employees: employees.map((e) => ({ id: e.id, status: e.status })),
    punches: punches.map((p) => ({
      employeeId: p.employeeId,
      clockIn: p.clockIn,
      clockOut: p.clockOut,
      voidedAt: p.voidedAt ?? null,
    })),
    timeOff: timeOff.map((t) => ({
      employeeId: t.employeeId,
      startDate: t.startDate,
      endDate: t.endDate,
    })),
    holidays: holidays.map((h) => h.date),
    period: { id: period.id, startDate: period.startDate, endDate: period.endDate },
    workingDays: payPeriod.workingDays,
    now: new Date(),
    timezone: company.timezone,
    thresholds: {
      shortMinutes: automation.suspiciousDurationMinutesShortThreshold,
      longMinutes: automation.suspiciousDurationMinutesLongThreshold,
    },
  });

  // Diff against existing alerts for the period (don't duplicate).
  const existing = await listAlertsForPeriod(period.id);
  const existingKey = new Set(
    existing.map((a) => `${a.employeeId}|${a.date}|${a.issue}`),
  );
  const fresh = detected.filter(
    (a) => !existingKey.has(`${a.employeeId}|${a.date}|${a.issue}`),
  );
  if (fresh.length > 0) {
    await createAlerts(
      fresh.map((a) => ({
        employeeId: a.employeeId,
        periodId: period.id,
        date: a.date,
        issue: a.issue,
      })),
    );
  }

  // Notifications: missed_punch.detected → affected employee.
  const employeesNeedingNotice = [...new Set(fresh.map((a) => a.employeeId))];
  const empToUser = await userIdsForEmployees(employeesNeedingNotice);
  const employeeNotices = fresh
    .map((a) => {
      const recipientId = empToUser.get(a.employeeId);
      if (!recipientId) return null;
      return {
        recipientId,
        kind: "missed_punch.detected" as const,
        payload: { date: a.date, issue: a.issue, periodId: period.id },
      };
    })
    .filter((n): n is NonNullable<typeof n> => n !== null);
  if (employeeNotices.length > 0) await dispatch(employeeNotices);

  // Transition.
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
  // Notify admins that a run is awaiting review.
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
