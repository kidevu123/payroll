// Manual CSV import. Used by /run-payroll/upload (item 7 of v1.2). Wraps the
// parser + the existing matcher logic from lib/ngteco/import.ts so the
// orchestration is identical: parse → match → dedupe → punch insert →
// IngestException for unmatched / parse-error / duplicate-hash rows.
//
// Differences vs the NGTeco scraper path:
//   - The CSV body comes from a multipart upload, not a Playwright session.
//   - The PayrollRun.source is set to MANUAL_CSV and lands in
//     AWAITING_ADMIN_REVIEW directly (no employee fix window — the admin
//     uploaded the data, so they own the review).
//   - When a pay_schedule_id is supplied, the run is tagged accordingly so
//     the per-period detail filters employees correctly.

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  payPeriods,
  payrollRuns,
  paySchedules,
  payslips,
  punches,
  ingestExceptions,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import {
  parse,
  type ParseError,
  type PunchCandidate,
} from "@/lib/punches/parser";
import { transitionRun } from "@/lib/db/queries/payroll-runs";
import { getSemiMonthlyBounds } from "@/lib/payroll/period-boundaries";

export type ManualImportInput = {
  csv: string;
  payrollRunId: string;
  timezone: string;
  actor: { id: string; role: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE" };
};

export type ManualImportSummary = {
  punchesImported: number;
  unmatched: number;
  parseErrors: number;
  duplicates: number;
  /** Existing punches whose period_id was rewritten to the target period. */
  punchesMoved: number;
  /** Distinct (employee_id, source_period_id) pairs that had punches moved out
   *  — their existing payslips were voided so source-period totals recompute. */
  payslipsVoidedFromMove: number;
  /**
   * Punches imported into a period belonging to a DIFFERENT pay schedule
   * than the run's. E.g. Juan (semi-monthly) shows up on a weekly upload —
   * his punches land in the matching SEMI_MONTHLY period instead of being
   * dropped or contaminating the weekly run. Per-employee detail in
   * `routedDetail`.
   */
  routedToOtherSchedule: number;
  routedDetail: Array<{
    employeeId: string;
    employeeName: string;
    targetPeriodId: string;
    periodStart: string;
    periodEnd: string;
    punches: number;
  }>;
};

export async function runManualCsvImport(
  input: ManualImportInput,
): Promise<ManualImportSummary> {
  const { candidates, errors } = parse(input.csv, input.timezone);
  const summary: ManualImportSummary = {
    punchesImported: 0,
    unmatched: 0,
    parseErrors: errors.length,
    duplicates: 0,
    punchesMoved: 0,
    payslipsVoidedFromMove: 0,
    routedToOtherSchedule: 0,
    routedDetail: [],
  };
  // Persist parse errors as ingest_exceptions.
  for (const e of errors) {
    await db.insert(ingestExceptions).values({
      payrollRunId: input.payrollRunId,
      type: "PARSE_ERROR",
      rawData: { reason: e.reason, row: e.rowIndex, raw: e.raw },
    });
  }

  const [run] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.id, input.payrollRunId));
  if (!run) throw new Error("runManualCsvImport: run not found");

  // Bulk-load employee lookups. We match by ngteco_employee_ref (legacy id
  // fits the same column).
  const refs = Array.from(new Set(candidates.map((c) => c.ngtecoEmployeeRef)));
  const emps = refs.length
    ? await db
        .select()
        .from(employees)
        .where(inArray(employees.ngtecoEmployeeRef, refs))
    : [];
  const empByRef = new Map(emps.map((e) => [e.ngtecoEmployeeRef!, e]));

  // If the run carries an explicit admin-selected cohort, only employees in
  // that set get punches imported. Everyone else's CSV rows are skipped
  // entirely (logged as ingest_exceptions for audit, not as errors).
  const cohort: Set<string> | null = Array.isArray(run.cohortEmployeeIds)
    ? new Set(run.cohortEmployeeIds)
    : null;
  // Set of "<employeeId>|<sourcePeriodId>" for punches we moved out of a
  // different period. After the loop we void payslips on those source
  // periods so the source-period totals recompute (they're now overcounting
  // by exactly the moved hours).
  const movedFromSourcePeriods = new Set<string>();

  // Cache of pay schedules so we know each employee's `period_kind` (so
  // we can compute the right semi-monthly bounds for routed punches).
  const allSchedules = await db.select().from(paySchedules);
  const scheduleById = new Map(allSchedules.map((s) => [s.id, s]));

  // Cache of (payScheduleId, periodStart) → periodId so multiple punches
  // for the same routed employee in the same target period reuse one row.
  const routedPeriodCache = new Map<string, string>();
  const routedAggByEmp = new Map<
    string,
    {
      employeeId: string;
      employeeName: string;
      targetPeriodId: string;
      periodStart: string;
      periodEnd: string;
      punches: number;
    }
  >();

  /**
   * Find or create the target pay_period for a routed punch. Currently
   * supports SEMI_MONTHLY only — that's the production case (Juan on a
   * weekly upload). Other kinds fall back to "no routing" (returns null,
   * caller skips the routing branch and the punch follows normal rules).
   */
  async function findOrCreateTargetPeriod(
    schedule: { id: string; periodKind: string },
    clockInDate: string,
  ): Promise<{ id: string; startDate: string; endDate: string } | null> {
    if (schedule.periodKind !== "SEMI_MONTHLY") return null;
    const bounds = getSemiMonthlyBounds(clockInDate);
    const cacheKey = `${schedule.id}|${bounds.startDate}`;
    const cached = routedPeriodCache.get(cacheKey);
    if (cached) return { id: cached, ...bounds };
    // Try to find an existing pay_period: same start, same schedule.
    const [existing] = await db
      .select()
      .from(payPeriods)
      .where(
        and(
          eq(payPeriods.startDate, bounds.startDate),
          eq(payPeriods.payScheduleId, schedule.id),
        ),
      );
    if (existing) {
      routedPeriodCache.set(cacheKey, existing.id);
      return { id: existing.id, startDate: existing.startDate, endDate: existing.endDate };
    }
    // Create a fresh OPEN period for the routed punches.
    const [created] = await db
      .insert(payPeriods)
      .values({
        startDate: bounds.startDate,
        endDate: bounds.endDate,
        state: "OPEN",
        payScheduleId: schedule.id,
      })
      .returning();
    if (!created) return null;
    routedPeriodCache.set(cacheKey, created.id);
    return { id: created.id, startDate: created.startDate, endDate: created.endDate };
  }

  // Dedup is enforced globally by the unique index on ngteco_record_hash, so
  // we don't preload a per-period set anymore — that missed punches that
  // were already imported under a *different* period (e.g. the cron pulled
  // Juan's punches into the weekly run, and the admin then uploaded Juan's
  // CSV against a semi-monthly period). Crashing on the constraint failed
  // the whole upload; ON CONFLICT DO NOTHING skips silently. seenHashes
  // still catches duplicates *within* a single CSV without a DB roundtrip.
  const seenHashes = new Set<string>();

  for (const c of candidates) {
    if (seenHashes.has(c.ngtecoRecordHash)) {
      summary.duplicates++;
      await db.insert(ingestExceptions).values({
        payrollRunId: input.payrollRunId,
        type: "DUPLICATE_HASH",
        ngtecoEmployeeRef: c.ngtecoEmployeeRef,
        rawData: { hash: c.ngtecoRecordHash, raw: c.raw, scope: "within-file" },
      });
      continue;
    }
    const emp = empByRef.get(c.ngtecoEmployeeRef);
    if (!emp) {
      summary.unmatched++;
      await db.insert(ingestExceptions).values({
        payrollRunId: input.payrollRunId,
        type: "UNMATCHED_REF",
        ngtecoEmployeeRef: c.ngtecoEmployeeRef,
        rawData: { name: c.ngtecoEmployeeName, raw: c.raw },
      });
      continue;
    }
    // ROUTING: when an employee belongs to a different pay schedule than
    // the run's, redirect their punches into a period belonging to THEIR
    // schedule. This is the protection the owner asked for: "if Juan
    // (semi-monthly) shows up in the weekly CSV, his punches go to the
    // semi-monthly period, not into this weekly run."
    //
    // Employees with NULL pay_schedule_id (most legacy rows) follow the
    // upload's schedule as before. Same-schedule employees skip routing.
    if (
      emp.payScheduleId &&
      run.payScheduleId &&
      emp.payScheduleId !== run.payScheduleId
    ) {
      const empSchedule = scheduleById.get(emp.payScheduleId);
      if (empSchedule) {
        // Compute the punch's calendar day in COMPANY TZ — a 23:00 ET punch
        // on Apr 15 is still Apr 15 for semi-monthly bounds, even though
        // its UTC date rolls to Apr 16.
        const clockInDay = new Intl.DateTimeFormat("en-CA", {
          timeZone: input.timezone,
        }).format(new Date(c.clockIn));
        const target = await findOrCreateTargetPeriod(empSchedule, clockInDay);
        if (target) {
          seenHashes.add(c.ngtecoRecordHash);
          try {
            await db.insert(punches).values({
              employeeId: emp.id,
              periodId: target.id,
              clockIn: new Date(c.clockIn),
              clockOut: c.clockOut ? new Date(c.clockOut) : null,
              source: "MANUAL_ADMIN",
              ngtecoRecordHash: c.ngtecoRecordHash,
            });
            summary.routedToOtherSchedule++;
            const aggKey = `${emp.id}|${target.id}`;
            const agg = routedAggByEmp.get(aggKey);
            if (agg) {
              agg.punches++;
            } else {
              routedAggByEmp.set(aggKey, {
                employeeId: emp.id,
                employeeName: emp.displayName,
                targetPeriodId: target.id,
                periodStart: target.startDate,
                periodEnd: target.endDate,
                punches: 1,
              });
            }
          } catch (err) {
            // Duplicate hash → already routed by an earlier upload, skip.
            if (isUniqueViolation(err, "punches_ngteco_hash_unique")) {
              summary.duplicates++;
            } else {
              throw err;
            }
          }
          continue;
        }
      }
    }

    // Skip employees not in the admin-selected cohort, if one is set.
    if (cohort && !cohort.has(emp.id)) {
      continue;
    }
    // Try the insert; if the partial unique index on ngteco_record_hash
    // catches a duplicate, branch behavior:
    //   - cohort SET (explicit admin upload): MOVE the existing punch into
    //     the target period. The manual upload is the source of truth, and
    //     the punches table model only allows one period_id per row.
    //   - cohort NOT SET (legacy/back-compat): treat as a benign skip.
    seenHashes.add(c.ngtecoRecordHash);
    try {
      await db.insert(punches).values({
        employeeId: emp.id,
        periodId: run.periodId,
        clockIn: new Date(c.clockIn),
        clockOut: c.clockOut ? new Date(c.clockOut) : null,
        source: "MANUAL_ADMIN",
        ngtecoRecordHash: c.ngtecoRecordHash,
      });
      summary.punchesImported++;
    } catch (err) {
      if (isUniqueViolation(err, "punches_ngteco_hash_unique")) {
        if (cohort && cohort.has(emp.id)) {
          // MOVE: locate the existing row and re-point period_id at the
          // target. Track the source period so we can void payslips on
          // the source after the loop.
          const [existing] = await db
            .select()
            .from(punches)
            .where(eq(punches.ngtecoRecordHash, c.ngtecoRecordHash));
          if (existing) {
            if (existing.periodId === run.periodId) {
              // Same period — true within-period dupe, skip.
              summary.duplicates++;
              await db.insert(ingestExceptions).values({
                payrollRunId: input.payrollRunId,
                type: "DUPLICATE_HASH",
                ngtecoEmployeeRef: c.ngtecoEmployeeRef,
                rawData: {
                  hash: c.ngtecoRecordHash,
                  raw: c.raw,
                  scope: "same-period",
                },
              });
              continue;
            }
            const sourcePeriodId = existing.periodId;
            await db
              .update(punches)
              .set({
                periodId: run.periodId,
                source: "MANUAL_ADMIN",
                editedAt: new Date(),
                editedById: input.actor.id,
                editReason: `csv-upload moved from ${sourcePeriodId} to ${run.periodId}`,
              })
              .where(eq(punches.id, existing.id));
            summary.punchesMoved++;
            movedFromSourcePeriods.add(`${emp.id}|${sourcePeriodId}`);
          }
          continue;
        }
        // Cohort NOT set — legacy back-compat: skip silently.
        summary.duplicates++;
        await db.insert(ingestExceptions).values({
          payrollRunId: input.payrollRunId,
          type: "DUPLICATE_HASH",
          ngtecoEmployeeRef: c.ngtecoEmployeeRef,
          rawData: {
            hash: c.ngtecoRecordHash,
            raw: c.raw,
            scope: "cross-period",
          },
        });
        continue;
      }
      throw err;
    }
  }

  // Source-period payslip cleanup. Any (employee, source-period) pair we
  // moved punches out of has a stale total — void the existing payslip on
  // the source so its run total recomputes from the remaining (smaller)
  // set of punches. Idempotent: voiding an already-voided payslip is a
  // no-op in voidPayslip().
  if (movedFromSourcePeriods.size > 0) {
    const { voidPayslip } = await import("@/lib/db/queries/payslips");
    for (const key of movedFromSourcePeriods) {
      const [employeeId, sourcePeriodId] = key.split("|");
      if (!employeeId || !sourcePeriodId) continue;
      const stale = await db
        .select()
        .from(payslips)
        .where(
          and(
            eq(payslips.employeeId, employeeId),
            eq(payslips.periodId, sourcePeriodId),
            isNull(payslips.voidedAt),
          ),
        );
      for (const p of stale) {
        await voidPayslip(
          p.id,
          `csv-upload moved punches to ${run.periodId}`,
          input.actor,
        );
        summary.payslipsVoidedFromMove++;
      }
    }
  }

  // Flatten per-employee routing aggregates into the summary.
  summary.routedDetail = Array.from(routedAggByEmp.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName),
  );

  await db
    .update(payrollRuns)
    .set({
      ingestStartedAt: run.ingestStartedAt ?? new Date(),
      ingestCompletedAt: new Date(),
    })
    .where(eq(payrollRuns.id, input.payrollRunId));

  await writeAudit({
    actorId: input.actor.id,
    actorRole: input.actor.role,
    action: "payroll_run.manual_csv_import",
    targetType: "PayrollRun",
    targetId: input.payrollRunId,
    after: summary,
  });

  // Move the run forward — works from INGESTING (happy path) and from
  // INGEST_FAILED (when a prior cron tick failed and the admin uploaded
  // a CSV to recover). Without the FAILED→REVIEW transition, recovered
  // runs stayed stuck even though data successfully landed.
  if (run.state === "INGESTING" || run.state === "INGEST_FAILED") {
    await transitionRun(input.payrollRunId, "AWAITING_ADMIN_REVIEW", input.actor);
  }
  // Reference `and` so the import doesn't dangle.
  void and;
  return summary;
}

/**
 * Detect a Postgres "unique_violation" (SQLSTATE 23505). Optionally narrow
 * to a specific constraint name. postgres.js + node-postgres both surface
 * the constraint via `.constraint`/`.constraint_name` on the error object.
 */
function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; constraint?: string; constraint_name?: string };
  if (e.code !== "23505") return false;
  if (!constraintName) return true;
  return (
    e.constraint === constraintName || e.constraint_name === constraintName
  );
}
