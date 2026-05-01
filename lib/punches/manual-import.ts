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

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  payrollRuns,
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

  // Existing dedupe hashes for this run's period (light filter — full unique
  // index on ngteco_record_hash catches the rest).
  const seenHashes = new Set<string>();
  const existing = await db
    .select({ hash: punches.ngtecoRecordHash })
    .from(punches)
    .where(eq(punches.periodId, run.periodId));
  for (const r of existing) if (r.hash) seenHashes.add(r.hash);

  for (const c of candidates) {
    if (seenHashes.has(c.ngtecoRecordHash)) {
      summary.duplicates++;
      await db.insert(ingestExceptions).values({
        payrollRunId: input.payrollRunId,
        type: "DUPLICATE_HASH",
        ngtecoEmployeeRef: c.ngtecoEmployeeRef,
        rawData: { hash: c.ngtecoRecordHash, raw: c.raw },
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
    await db.insert(punches).values({
      employeeId: emp.id,
      periodId: run.periodId,
      clockIn: new Date(c.clockIn),
      clockOut: c.clockOut ? new Date(c.clockOut) : null,
      source: "MANUAL_ADMIN",
      ngtecoRecordHash: c.ngtecoRecordHash,
    });
    seenHashes.add(c.ngtecoRecordHash);
    summary.punchesImported++;
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
