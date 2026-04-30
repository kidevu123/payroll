// Read + write helpers for payroll_runs.
//
// Phase 2 ships the parts the NGTeco import + run-history pages need:
// listRuns(limit), getRun(id), createRun(periodId), and a tiny set of
// state transitions used by the import flow. The full state machine
// (review → approve → publish) lands in Phase 3.

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payrollRuns,
  ingestExceptions,
  type PayrollRun,
  type IngestException,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

export async function listRuns(limit = 30): Promise<PayrollRun[]> {
  return db
    .select()
    .from(payrollRuns)
    .orderBy(desc(payrollRuns.createdAt))
    .limit(limit);
}

export async function getRun(id: string): Promise<PayrollRun | null> {
  const [row] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id));
  return row ?? null;
}

export async function createRun(
  periodId: string,
  scheduledFor: Date,
  actor: Actor | null = null,
): Promise<PayrollRun> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(payrollRuns)
      .values({ periodId, scheduledFor, state: "SCHEDULED" })
      .returning();
    if (!row) throw new Error("createRun: insert returned no row");
    await writeAudit(
      {
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action: "payroll_run.create",
        targetType: "PayrollRun",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function markIngestFailed(
  id: string,
  reason: string,
  artifacts: { screenshotPath?: string; logPath?: string } = {},
): Promise<void> {
  await db
    .update(payrollRuns)
    .set({
      state: "INGEST_FAILED",
      lastError: reason,
      ingestScreenshotPath: artifacts.screenshotPath ?? null,
      ingestLogPath: artifacts.logPath ?? null,
      retryCount: 0,
    })
    .where(eq(payrollRuns.id, id));
}

export async function listExceptions(runId: string): Promise<IngestException[]> {
  return db
    .select()
    .from(ingestExceptions)
    .where(eq(ingestExceptions.payrollRunId, runId));
}
