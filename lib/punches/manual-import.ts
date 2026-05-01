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
  payrollRuns,
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

export type ManualImportInput = {
  csv: string;
  payrollRunId: string;
  timezone: string;
  actor: { id: string; role: "OWNER" | "ADMIN" | "EMPLOYEE" };
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

  // Move the run forward.
  if (run.state === "INGESTING") {
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
