import { join } from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payPeriods, timeOffRequests } from "@/lib/db/schema";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches, findDuplicatePunchClusters } from "@/lib/db/queries/punches";
import { listPayslipsForPeriod } from "@/lib/db/queries/payslips";
import { listRates } from "@/lib/db/queries/rate-history";
import { listAlertsForPeriod } from "@/lib/db/queries/alerts";
import { listPendingMissedPunchRequests } from "@/lib/db/queries/requests";
import { getLastSuccessfulPoll, listRecentPolls } from "@/lib/db/queries/poll-history";
import { getSetting } from "@/lib/settings/runtime";
import { detectExceptions } from "@/lib/payroll/detect-exceptions";
import { computePay } from "@/lib/payroll/computePay";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { isOpenShiftPunch } from "@/lib/punches/missing-punch";
import { companyTodayIso } from "@/lib/time/company-day";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";
import type {
  HallMonitorFinding,
  HallMonitorWeeklyReport,
} from "./types";
import { weekEndingSunday, weekStartFromEnd } from "./week-bounds";

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? "/data";
const REPORT_DIR = join(STORAGE_ROOT, "hall-monitor");

function finding(
  partial: Omit<HallMonitorFinding, "id"> & { id?: string },
): HallMonitorFinding {
  const { detail, bullets, href, hrefLabel, title, meaning, action, ...rest } =
    partial;
  return {
    id: partial.id ?? `${partial.category}:${partial.message.slice(0, 40)}`,
    ...rest,
    ...(title ? { title } : {}),
    ...(meaning ? { meaning } : {}),
    ...(action ? { action } : {}),
    ...(bullets && bullets.length > 0 ? { bullets } : {}),
    ...(href ? { href } : {}),
    ...(hrefLabel ? { hrefLabel } : {}),
    ...(detail ? { detail } : {}),
  };
}

function summarize(findings: HallMonitorFinding[]) {
  return findings.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { ok: 0, warn: 0, fail: 0 },
  );
}

/** Run all weekly hall-monitor checks and return a structured report. */
export async function runWeeklyHallMonitorAudit(
  now = new Date(),
): Promise<HallMonitorWeeklyReport> {
  const [company, payRules, payPeriodSettings, automation] = await Promise.all([
    getSetting("company"),
    getSetting("payRules"),
    getSetting("payPeriod"),
    getSetting("automation"),
  ]);

  const tz = company.timezone;
  const todayIso = companyTodayIso(now, tz);
  const weekEnd = weekEndingSunday(todayIso);
  const weekStart = weekStartFromEnd(weekEnd);
  const findings: HallMonitorFinding[] = [];

  const employees = await listEmployees({ status: "ACTIVE" });
  const hourlyActive = employees.filter(
    (e) => e.hourlyRateCents !== null && e.hourlyRateCents > 0,
  );

  const openPeriods = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.state, "OPEN"));

  const allPunches =
    openPeriods.length > 0
      ? (
          await Promise.all(
            openPeriods.map((p) => listPunches({ periodId: p.id })),
          )
        ).flat()
      : [];

  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  const dayKey = (d: Date) => dayFmt.format(d);

  // ── NGTeco sync health ───────────────────────────────────────────────────
  const lastOk = await getLastSuccessfulPoll();
  const recentPolls = await listRecentPolls(50);
  const weekPolls = recentPolls.filter((p) => {
    const day = dayKey(p.startedAt);
    return day >= weekStart && day <= weekEnd;
  });
  const failedPolls = weekPolls.filter((p) => !p.ok);

  if (!lastOk) {
    findings.push(
      finding({
        severity: "fail",
        category: "ngteco_sync",
        message: "No successful NGTeco poll on record.",
        title: "Time clock has never synced successfully",
        meaning:
          "Milo pulls punches from NGTeco automatically. Without a successful import, nobody's hours update on their own.",
        action:
          "Open NGTeco, confirm credentials, and run Poll now until it succeeds.",
        href: "/ngteco",
        hrefLabel: "Open NGTeco",
      }),
    );
  } else {
    const ageMs = now.getTime() - lastOk.finishedAt!.getTime();
    const ageHours = ageMs / (60 * 60 * 1000);
    if (ageHours > 2) {
      const rounded = Math.round(ageHours);
      findings.push(
        finding({
          severity: ageHours > 6 ? "fail" : "warn",
          category: "ngteco_sync",
          message: `Last successful NGTeco poll was ${rounded}h ago.`,
          title: `Time clock sync is ${rounded} hours behind`,
          meaning:
            "New clock-ins and clock-outs from the fingerprint machines may not be in Milo yet. Payroll could be wrong until sync catches up.",
          action:
            "Run Poll now from the dashboard. If it fails, fix NGTeco login first.",
          href: "/dashboard",
          hrefLabel: "Go to dashboard",
          detail: {
            finishedAt: lastOk.finishedAt?.toISOString(),
            eventsScraped: lastOk.eventsScraped,
          },
        }),
      );
    } else {
      findings.push(
        finding({
          severity: "ok",
          category: "ngteco_sync",
          message: "NGTeco poll is current (within 2h).",
          title: "Time clock sync is up to date",
          meaning: "Punches are importing from NGTeco on schedule.",
          action: "No action needed.",
        }),
      );
    }
  }

  if (failedPolls.length > 0) {
    findings.push(
      finding({
        severity: failedPolls.length >= 3 ? "fail" : "warn",
        category: "ngteco_sync",
        message: `${failedPolls.length} failed NGTeco poll(s) during the week.`,
        title: `${failedPolls.length} failed time-clock import(s) this week`,
        meaning:
          "The automatic login or scrape to NGTeco broke. Punches stop flowing into Milo until this is fixed.",
        action:
          "Try Poll now. If errors repeat, refresh NGTeco login in Settings.",
        href: "/ngteco",
        hrefLabel: "Open NGTeco",
        detail: {
          errors: failedPolls.slice(0, 5).map((p) => p.errorMessage),
        },
      }),
    );
  }

  // ── Roster / coverage setup ──────────────────────────────────────────────
  const missingNgtecoRef = hourlyActive.filter((e) => !e.ngtecoEmployeeRef);
  if (missingNgtecoRef.length > 0) {
    const names = missingNgtecoRef.map((e) => e.displayName);
    findings.push(
      finding({
        severity: "warn",
        category: "roster",
        message: `${missingNgtecoRef.length} active hourly employee(s) have no NGTeco ref — poll will skip them.`,
        title: `${names.length} employee(s) not linked to the time clock`,
        meaning:
          "These people are active hourly in Milo but have no NGTeco ID. Automatic imports skip them.",
        action:
          "Open each employee and set their NGTeco employee ref from the time clock roster.",
        bullets: names,
        href: "/employees",
        hrefLabel: "Open employees",
        detail: { names },
      }),
    );
  }

  // ── Punch integrity (open shifts, duplicates) ────────────────────────────
  const openShifts = allPunches.filter(
    (p) => !p.voidedAt && isOpenShiftPunch(p),
  );
  if (openShifts.length > 0) {
    const empName = new Map(employees.map((e) => [e.id, e.displayName]));
    findings.push(
      finding({
        severity: "warn",
        category: "punch_integrity",
        message: `${openShifts.length} open shift(s) still missing clock-out.`,
        title: `${openShifts.length} shift(s) missing a clock-out`,
        meaning:
          "Someone punched in but has no clock-out on file. That day's hours are incomplete.",
        action:
          "Open the Time grid, pick the day, and close each open shift with the real clock-out.",
        bullets: openShifts.slice(0, 8).map((p) => {
          const name = empName.get(p.employeeId) ?? "Employee";
          const when = new Intl.DateTimeFormat("en-US", {
            timeZone: tz,
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(p.clockIn);
          return `${name} — clocked in ${when}, no clock-out yet`;
        }),
        href: "/time",
        hrefLabel: "Open time grid",
        detail: {
          samples: openShifts.slice(0, 8).map((p) => ({
            employeeId: p.employeeId,
            clockIn: p.clockIn.toISOString(),
          })),
        },
      }),
    );
  }

  for (const period of openPeriods) {
    const clusters = await findDuplicatePunchClusters({ periodId: period.id });
    if (clusters.length > 0) {
      findings.push(
        finding({
          severity: "warn",
          category: "punch_integrity",
          message: `${clusters.length} duplicate punch cluster(s) in period ${period.startDate}–${period.endDate}.`,
          title: `${clusters.length} possible duplicate punch(es)`,
          meaning:
            "The same shift may exist twice. That can double hours if you do not merge them.",
          action:
            "On the payroll period, use Find duplicates and keep the correct shift.",
          bullets: [`Pay period ${period.startDate} – ${period.endDate}`],
          href: `/payroll/${period.id}`,
          hrefLabel: "Open this period",
          detail: {
            periodId: period.id,
            periodStart: period.startDate,
            periodEnd: period.endDate,
            clusterCount: clusters.length,
          },
        }),
      );
    }
  }

  // ── Exception detection vs persisted alerts ──────────────────────────────
  const { listHolidaysInRange } = await import("@/lib/db/queries/holidays");
  const { listApprovedTimeOffInRange } = await import(
    "@/lib/db/queries/time-off"
  );
  const holidays = await listHolidaysInRange(weekStart, weekEnd);
  const timeOff = await listApprovedTimeOffInRange(weekStart, weekEnd);

  for (const period of openPeriods) {
    const periodPunches = allPunches.filter((p) => p.periodId === period.id);
    const detected = detectExceptions({
      employees: employees.map((e) => ({
        id: e.id,
        status: e.status,
      })),
      punches: periodPunches,
      timeOff,
      holidays: holidays.map((h) => h.date),
      period: {
        id: period.id,
        startDate: period.startDate,
        endDate: period.endDate,
      },
      workingDays: payPeriodSettings.workingDays,
      now,
      timezone: tz,
      thresholds: {
        shortMinutes: automation.suspiciousDurationMinutesShortThreshold,
        longMinutes: automation.suspiciousDurationMinutesLongThreshold,
      },
    });

    const weekDetected = detected.filter(
      (a) => a.date >= weekStart && a.date <= weekEnd,
    );
    const byIssue = weekDetected.reduce<Record<string, number>>((acc, a) => {
      acc[a.issue] = (acc[a.issue] ?? 0) + 1;
      return acc;
    }, {});

    if (weekDetected.length > 0) {
      findings.push(
        finding({
          severity: "warn",
          category: "coverage",
          message: `${weekDetected.length} attendance exception(s) detected for week ${weekStart}–${weekEnd}.`,
          detail: { periodId: period.id, byIssue },
        }),
      );
    }

    const unresolved = await listAlertsForPeriod(period.id, {
      unresolvedOnly: true,
    });
    if (unresolved.length > 0) {
      findings.push(
        finding({
          severity: "warn",
          category: "coverage",
          message: `${unresolved.length} unresolved missed-punch alert(s) on open period.`,
          title: `${unresolved.length} missed-punch problem(s) still open`,
          meaning:
            "Clock issues are flagged but not closed. Pay can be wrong if you run payroll before fixing them.",
          action:
            "Open Calendar → Pending, or the Time grid. Close shifts or approve employee fixes.",
          bullets: [`Pay period ${period.startDate} – ${period.endDate}`],
          href: "/calendar",
          hrefLabel: "Open calendar",
          detail: {
            periodId: period.id,
            periodStart: period.startDate,
            periodEnd: period.endDate,
          },
        }),
      );
    }
  }

  // ── Pending employee fixes ───────────────────────────────────────────────
  const pendingMissed = await listPendingMissedPunchRequests();
  if (pendingMissed.length > 0) {
    findings.push(
      finding({
        severity: "warn",
        category: "pending_work",
        message: `${pendingMissed.length} missed-punch request(s) awaiting admin approval.`,
        title: `${pendingMissed.length} employee fix(es) waiting for your OK`,
        meaning:
          "Someone submitted a missed punch correction. Payroll does not use it until you approve.",
        action:
          "Open Calendar → Pending. Compare on-file time vs what they proposed, then Approve or Reject.",
        href: "/calendar",
        hrefLabel: "Open pending",
      }),
    );
  }

  const pendingTimeOff = await db
    .select({ id: timeOffRequests.id })
    .from(timeOffRequests)
    .where(eq(timeOffRequests.status, "PENDING"));
  if (pendingTimeOff.length > 0) {
    findings.push(
      finding({
        severity: "warn",
        category: "pending_work",
        message: `${pendingTimeOff.length} time-off request(s) pending.`,
        title: `${pendingTimeOff.length} time-off request(s) waiting`,
        meaning: "Employees asked for time off that you have not approved yet.",
        action: "Open Calendar and approve or reject each request.",
        href: "/calendar",
        hrefLabel: "Open calendar",
      }),
    );
  }

  // ── Pay math drift (stored payslip vs live computePay) ───────────────────
  const DRIFT_HOURS = 0.5;
  const DRIFT_CENTS = 100;

  for (const period of openPeriods) {
    const periodPunches = allPunches.filter((p) => p.periodId === period.id);
    const payslips = await listPayslipsForPeriod(period.id);
    const punchesByE = new Map<string, typeof periodPunches>();
    for (const p of periodPunches) {
      const list = punchesByE.get(p.employeeId) ?? [];
      list.push(p);
      punchesByE.set(p.employeeId, list);
    }

    const drifts: {
      name: string;
      hoursDelta: number;
      centsDelta: number;
    }[] = [];

    for (const ps of payslips) {
      if (ps.voidedAt) continue;
      const emp = employees.find((e) => e.id === ps.employeeId);
      if (!emp) continue;
      const raw = punchesByE.get(ps.employeeId) ?? [];
      const ePunches = dedupNearDuplicatePunches(raw);
      const rates = await listRates(ps.employeeId);
      const result = computePay({
        punches: ePunches,
        rateAt: (p) => {
          const day = (
            p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn)
          )
            .toISOString()
            .slice(0, 10);
          for (const r of rates)
            if (r.effectiveFrom <= day) return r.hourlyRateCents;
          return emp.hourlyRateCents ?? 0;
        },
        taskPay: [],
        timezone: tz,
        rules: {
          rounding: payRules.rounding,
          hoursDecimalPlaces: payRules.hoursDecimalPlaces,
          ...(payRules.overtime.enabled
            ? {
                overtime: {
                  thresholdHours: payRules.overtime.thresholdHours,
                  multiplier: payRules.overtime.multiplier,
                },
              }
            : {}),
        },
      });
      const hoursDelta = Math.abs(
        Number(ps.hoursWorked ?? 0) - result.totalHours,
      );
      const centsDelta = Math.abs(ps.roundedPayCents - result.roundedCents);
      if (hoursDelta > DRIFT_HOURS || centsDelta > DRIFT_CENTS) {
        drifts.push({
          name: emp.displayName,
          hoursDelta,
          centsDelta,
        });
      }
    }

    if (drifts.length > 0) {
      findings.push(
        finding({
          severity: "warn",
          category: "pay_math",
          message: `${drifts.length} payslip(s) drift from live punch math on period ${period.startDate}–${period.endDate}.`,
          detail: { samples: drifts.slice(0, 10) },
        }),
      );
    }
  }

  if (findings.every((f) => f.severity === "ok")) {
    findings.push(
      finding({
        severity: "ok",
        category: "punch_integrity",
        message: "No blocking issues detected in weekly hall-monitor scan.",
      }),
    );
  }

  return {
    generatedAt: now.toISOString(),
    weekStart,
    weekEnd,
    timezone: tz,
    summary: summarize(findings),
    findings,
  };
}

export async function writeHallMonitorReport(
  report: HallMonitorWeeklyReport,
): Promise<string> {
  await mkdir(REPORT_DIR, { recursive: true });
  const path = join(REPORT_DIR, `${report.weekEnd}.json`);
  await writeFile(path, JSON.stringify(report, null, 2), "utf8");
  return path;
}

export async function readLatestHallMonitorReport(): Promise<{
  report: HallMonitorWeeklyReport;
  path: string;
} | null> {
  try {
    const files = (await readdir(REPORT_DIR))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    const latest = files[0];
    if (!latest) return null;
    const path = join(REPORT_DIR, latest);
    const raw = await readFile(path, "utf8");
    return {
      path,
      report: JSON.parse(raw) as HallMonitorWeeklyReport,
    };
  } catch {
    return null;
  }
}

/** Persist report, notify admins if anything failed or warned. */
export async function runWeeklyHallMonitorJob(): Promise<HallMonitorWeeklyReport> {
  const report = await runWeeklyHallMonitorAudit();
  const path = await writeHallMonitorReport(report);

  const needsAttention =
    report.summary.fail > 0 || report.summary.warn > 0;

  if (needsAttention) {
    const admins = await adminUserIds();
    await dispatch(
      admins.map((recipientId) => ({
        recipientId,
        kind: "hall_monitor.weekly_ready" as const,
        payload: {
          weekEnd: report.weekEnd,
          fails: report.summary.fail,
          warns: report.summary.warn,
          path,
        },
        push: {
          title: "Weekly payroll checklist",
          body:
            report.summary.fail > 0
              ? `${report.summary.fail} item(s) need fixing before payroll — open Hall monitor`
              : `${report.summary.warn} item(s) to review this week — open Hall monitor`,
          url: "/hall-monitor",
          tag: `hall_monitor_${report.weekEnd}`,
        },
      })),
    ).catch(() => undefined);
  }

  return report;
}
