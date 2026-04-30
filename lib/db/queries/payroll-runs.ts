// Read + write helpers for payroll_runs.
//
// Phase 2 added: list/get/create + markIngestFailed.
// Phase 3 adds the rest of the state-machine transitions: per spec §6 the
// run progresses SCHEDULED → INGESTING → AWAITING_EMPLOYEE_FIXES (or
// AWAITING_ADMIN_REVIEW) → APPROVED → PUBLISHED, plus terminal failure
// states. transitionRun gates on the legal-edge table.

import { desc, eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payrollRuns,
  payPeriods,
  ingestExceptions,
  type PayrollRun,
  type IngestException,
  payrollRunStateEnum,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

export type PayrollRunState = (typeof payrollRunStateEnum.enumValues)[number];

const LEGAL_TRANSITIONS: Record<PayrollRunState, readonly PayrollRunState[]> = {
  SCHEDULED: ["INGESTING", "CANCELLED"],
  INGESTING: ["AWAITING_EMPLOYEE_FIXES", "AWAITING_ADMIN_REVIEW", "INGEST_FAILED"],
  INGEST_FAILED: ["INGESTING", "CANCELLED"],
  AWAITING_EMPLOYEE_FIXES: ["AWAITING_ADMIN_REVIEW", "CANCELLED"],
  AWAITING_ADMIN_REVIEW: ["APPROVED", "AWAITING_ADMIN_REVIEW", "CANCELLED"],
  APPROVED: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  FAILED: ["INGESTING"],
  CANCELLED: [],
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

/**
 * Run for the currently-OPEN period, if any. Returns the most recent run
 * for that period (could be SCHEDULED, INGESTING, AWAITING_*, etc).
 */
export async function getCurrentRun(): Promise<PayrollRun | null> {
  const [openPeriod] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.state, "OPEN"))
    .orderBy(desc(payPeriods.startDate))
    .limit(1);
  if (!openPeriod) return null;
  const [row] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.periodId, openPeriod.id))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getRunForPeriod(periodId: string): Promise<PayrollRun | null> {
  const [row] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.periodId, periodId))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(1);
  return row ?? null;
}

export type TransitionMetadata = {
  /** When transitioning to APPROVED. */
  approvedById?: string;
  /** When entering AWAITING_ADMIN_REVIEW for the first time. */
  reviewedById?: string;
  /** When entering AWAITING_EMPLOYEE_FIXES, the deadline. */
  employeeFixDeadline?: Date;
  /** When entering INGESTING. */
  ingestStartedAt?: Date;
  /** When leaving INGESTING. */
  ingestCompletedAt?: Date;
  /** Counter bump on retry. */
  bumpRetry?: boolean;
  /** Free-text reason — written to audit, not the row. */
  reason?: string;
};

/**
 * Move a run from one state to another. Throws on illegal transitions.
 * The transition + any side-effect timestamps land in the same statement;
 * audit is enrolled in a transaction with the update.
 */
export async function transitionRun(
  id: string,
  to: PayrollRunState,
  actor: Actor | null,
  metadata: TransitionMetadata = {},
): Promise<PayrollRun> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.id, id));
    if (!before) throw new Error(`transitionRun: ${id} not found`);
    const allowed = LEGAL_TRANSITIONS[before.state] ?? [];
    if (!allowed.includes(to)) {
      throw new Error(
        `transitionRun: illegal transition ${before.state} -> ${to}`,
      );
    }
    const set: Partial<PayrollRun> = { state: to };
    if (metadata.ingestStartedAt) set.ingestStartedAt = metadata.ingestStartedAt;
    if (metadata.ingestCompletedAt) set.ingestCompletedAt = metadata.ingestCompletedAt;
    if (metadata.employeeFixDeadline) set.employeeFixDeadline = metadata.employeeFixDeadline;
    if (metadata.reviewedById) {
      set.reviewedById = metadata.reviewedById;
      set.reviewedAt = new Date();
    }
    if (metadata.approvedById) {
      set.approvedById = metadata.approvedById;
      set.approvedAt = new Date();
    }
    if (to === "PUBLISHED") set.publishedAt = new Date();
    if (metadata.bumpRetry) set.retryCount = (before.retryCount ?? 0) + 1;
    const [row] = await tx
      .update(payrollRuns)
      .set(set)
      .where(eq(payrollRuns.id, id))
      .returning();
    if (!row) throw new Error("transitionRun: returning() empty");
    await writeAudit(
      {
        actorId: actor?.id ?? null,
        actorRole: actor?.role ?? null,
        action: `payroll_run.${to.toLowerCase()}`,
        targetType: "PayrollRun",
        targetId: id,
        before,
        after: { ...row, ...(metadata.reason ? { reason: metadata.reason } : {}) },
      },
      tx,
    );
    return row;
  });
}

/**
 * Convenience for "I am the ingest job, mark this run as ingesting now."
 */
export async function markIngesting(id: string): Promise<void> {
  await db
    .update(payrollRuns)
    .set({ state: "INGESTING", ingestStartedAt: new Date() })
    .where(and(eq(payrollRuns.id, id), eq(payrollRuns.state, "SCHEDULED")));
}
