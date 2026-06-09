// Persist missed-punch alerts and notify employees/admins. Shared by
// payroll.run.detect-exceptions and the post–punch-poll end-of-day sync.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payPeriods } from "@/lib/db/schema";
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
import {
  detectExceptions,
  type DetectedAlert,
} from "@/lib/payroll/detect-exceptions";
import { dispatch } from "@/lib/notifications/router";
import { logger } from "@/lib/telemetry";

function issueLabel(issue: string): string {
  return issue.toLowerCase().replaceAll("_", " ");
}

function dayInTimezone(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

/** Drop same-day NO_PUNCH until the local end-of-day window (7pm). */
export function filterAlertsForPollSync(
  alerts: DetectedAlert[],
  timezone: string,
  now: Date,
): DetectedAlert[] {
  const today = dayInTimezone(now, timezone);
  const localHour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  return alerts.filter((a) => {
    if (a.issue !== "NO_PUNCH") return true;
    if (a.date < today) return true;
    return localHour >= 19;
  });
}

export type SyncMissedPunchResult = {
  periodsScanned: number;
  alertsCreated: number;
  employeeNotices: number;
};

export type SyncMissedPunchOpts = {
  /** When set, only emit alerts whose date is in this set (post-poll). */
  limitToDates?: ReadonlySet<string>;
  /** Extra filter (e.g. skip same-day NO_PUNCH before 7pm). */
  filterAlerts?: (alerts: DetectedAlert[]) => DetectedAlert[];
  /** When set, only scan this period (payroll run path). */
  periodId?: string;
  runId?: string | null;
};

/**
 * Scan OPEN pay periods, detect missed punches, persist new alerts, and
 * notify affected employees + admins. Idempotent on (employee, date, issue).
 */
export async function syncMissedPunchAlerts(
  opts: SyncMissedPunchOpts = {},
): Promise<SyncMissedPunchResult> {
  const [company, payPeriod, automation] = await Promise.all([
    getSetting("company"),
    getSetting("payPeriod"),
    getSetting("automation"),
  ]);
  const now = new Date();
  const openPeriods = opts.periodId
    ? await db
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.id, opts.periodId))
    : await db
        .select()
        .from(payPeriods)
        .where(eq(payPeriods.state, "OPEN"));

  let alertsCreated = 0;
  let employeeNotices = 0;

  for (const period of openPeriods) {
    const employeeFilter = period.payScheduleId
      ? { payScheduleId: period.payScheduleId }
      : {};
    const [employees, punches, holidays, timeOff] = await Promise.all([
      listEmployees(employeeFilter),
      listPunches({ periodId: period.id }),
      listHolidaysInRange(period.startDate, period.endDate),
      listApprovedTimeOffInRange(period.startDate, period.endDate),
    ]);

    let detected = detectExceptions({
      employees: employees.map((e) => ({ id: e.id, status: e.status })),
      punches: punches.map((p) => ({
        employeeId: p.employeeId,
        clockIn: p.clockIn,
        clockOut: p.clockOut,
        voidedAt: p.voidedAt ?? null,
        notes: p.notes ?? null,
      })),
      timeOff: timeOff.map((t) => ({
        employeeId: t.employeeId,
        startDate: t.startDate,
        endDate: t.endDate,
      })),
      holidays: holidays.map((h) => h.date),
      period: {
        id: period.id,
        startDate: period.startDate,
        endDate: period.endDate,
      },
      workingDays: payPeriod.workingDays,
      now,
      timezone: company.timezone,
      thresholds: {
        shortMinutes: automation.suspiciousDurationMinutesShortThreshold,
        longMinutes: automation.suspiciousDurationMinutesLongThreshold,
      },
    });

    if (opts.limitToDates) {
      detected = detected.filter((a) => opts.limitToDates!.has(a.date));
    }
    if (opts.filterAlerts) {
      detected = opts.filterAlerts(detected);
    }
    if (detected.length === 0) continue;

    const existing = await listAlertsForPeriod(period.id, {
      unresolvedOnly: true,
    });
    const existingKey = new Set(
      existing.map((a) => `${a.employeeId}|${a.date}|${a.issue}`),
    );
    const fresh = detected.filter(
      (a) => !existingKey.has(`${a.employeeId}|${a.date}|${a.issue}`),
    );
    if (fresh.length === 0) continue;

    await createAlerts(
      fresh.map((a) => ({
        employeeId: a.employeeId,
        periodId: period.id,
        date: a.date,
        issue: a.issue,
      })),
    );
    alertsCreated += fresh.length;

    const empToUser = await userIdsForEmployees([
      ...new Set(fresh.map((a) => a.employeeId)),
    ]);
    const notices = fresh
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
    if (notices.length > 0) {
      await dispatch(notices);
      employeeNotices += notices.length;
    }

    const adminAlertIssues = new Set(["MISSING_OUT", "MISSING_IN"]);
    const adminAlerts = fresh.filter((a) => adminAlertIssues.has(a.issue));
    if (adminAlerts.length > 0) {
      const admins = await adminUserIds();
      if (admins.length > 0) {
        const nameByEmployee = new Map(
          employees.map((e) => [e.id, e.displayName ?? "Employee"]),
        );
        const items = adminAlerts.map(
          (a) =>
            `${nameByEmployee.get(a.employeeId) ?? "Employee"}: ${issueLabel(a.issue)} on ${a.date}`,
        );
        const body =
          items.length <= 3
            ? items.join("; ")
            : `${items.slice(0, 3).join("; ")} + ${items.length - 3} more`;
        await dispatch(
          admins.map((id) => ({
            recipientId: id,
            kind: "admin.announcement" as const,
            payload: {
              title: "Possible missed punch",
              body,
              link: "/requests",
              periodId: period.id,
              runId: opts.runId ?? null,
              source: opts.runId
                ? "cron_missed_punch_alerts"
                : "punch_poll_missed_punch_sync",
            },
            push: {
              title: "Possible missed punch",
              body,
              url: "/requests",
              tag: `missed_punch_admin_${period.id}`,
            },
          })),
        );
      }
    }
  }

  if (alertsCreated > 0) {
    logger.info(
      { alertsCreated, employeeNotices, periodsScanned: openPeriods.length },
      "sync-missed-punch-alerts: done",
    );
  }

  return {
    periodsScanned: openPeriods.length,
    alertsCreated,
    employeeNotices,
  };
}
