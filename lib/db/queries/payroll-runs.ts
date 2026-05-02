// Read + write helpers for payroll_runs.
//
// Phase 2 added: list/get/create + markIngestFailed.
// Phase 3 adds the rest of the state-machine transitions: per spec §6 the
// run progresses SCHEDULED → INGESTING → AWAITING_EMPLOYEE_FIXES (or
// AWAITING_ADMIN_REVIEW) → APPROVED → PUBLISHED, plus terminal failure
// states. transitionRun gates on the legal-edge table.

import { desc, eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payrollRuns,
  payPeriods,
  payslips,
  paySchedules,
  users,
  ingestExceptions,
  zohoOrganizations,
  zohoPushes,
  type PayrollRun,
  type IngestException,
  payrollRunStateEnum,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import { sumByPeriod as sumTempByPeriod } from "@/lib/db/queries/temp-workers";

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

/**
 * Reports table row: one per payroll_run, joined with its period, schedule
 * and approver user (if any). Amount is the explicit total_amount_cents
 * for legacy rows; for cron/manual runs we fall back to sum(payslips.rounded).
 * Posting date prefers posted_at, then publishedAt, then approvedAt, then createdAt.
 *
 * Per-org Zoho push status is folded in so the Reports table can render
 * "Pushed (id)" pills without an N+1 lookup.
 */
export type ReportRow = {
  id: string;
  periodId: string;
  startDate: string;
  endDate: string;
  source: PayrollRun["source"];
  state: PayrollRun["state"];
  scheduleName: string | null;
  /** Run amount (payslips or stamped totalAmountCents). Excludes temp labor. */
  amountCents: number;
  /** Sum of (non-deleted) temp_worker_entries for the period. Same value for
   *  every run sharing a period; UI is responsible for displaying once. */
  tempLaborCents: number;
  createdByDisplay: string;
  postedAt: Date;
  publishedToPortalAt: Date | null;
  pdfPath: string | null;
  zohoPushes: Array<{ orgId: string; orgName: string; expenseId: string | null; pushedAt: Date }>;
};

export async function listReports(limit = 100): Promise<ReportRow[]> {
  const rows = await db
    .select({
      id: payrollRuns.id,
      periodId: payrollRuns.periodId,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      source: payrollRuns.source,
      state: payrollRuns.state,
      scheduleName: paySchedules.name,
      totalAmount: payrollRuns.totalAmountCents,
      payslipSum: sql<number>`COALESCE((
        SELECT SUM(${payslips.roundedPayCents})::int
        FROM ${payslips}
        WHERE ${payslips.payrollRunId} = ${payrollRuns.id}
          AND ${payslips.voidedAt} IS NULL
      ), 0)`,
      createdByName: payrollRuns.createdByName,
      approverDisplay: users.email,
      postedAt: payrollRuns.postedAt,
      publishedAt: payrollRuns.publishedAt,
      approvedAt: payrollRuns.approvedAt,
      createdAt: payrollRuns.createdAt,
      publishedToPortalAt: payrollRuns.publishedToPortalAt,
      pdfPath: payrollRuns.pdfPath,
    })
    .from(payrollRuns)
    .leftJoin(payPeriods, eq(payrollRuns.periodId, payPeriods.id))
    .leftJoin(paySchedules, eq(payrollRuns.payScheduleId, paySchedules.id))
    .leftJoin(users, eq(payrollRuns.approvedById, users.id))
    // Sort by the actual period the run pays out, newest first. Sorting by
    // postedAt put 2025 legacy imports above 2026 cron runs because the
    // legacy importer stamps postedAt = source-file mtime (often a 2026
    // re-import of historical 2025 reports). Period.endDate is what the
    // admin actually thinks of as "the report's date".
    .orderBy(desc(payPeriods.endDate), desc(payrollRuns.createdAt))
    .limit(limit);

  // Bulk-load zoho pushes per run to avoid an N+1. Use Drizzle's `inArray`
  // helper which expands to `IN (...)` — the prior `${runIds}::uuid[]`
  // template fragment fails Postgres parse with "cannot cast type record
  // to uuid[]" because postgres.js binds JS arrays as records, not text.
  const runIds = rows.map((r) => r.id);
  const pushes = runIds.length
    ? await db
        .select({
          payrollRunId: zohoPushes.payrollRunId,
          organizationId: zohoPushes.organizationId,
          orgName: zohoOrganizations.name,
          expenseId: zohoPushes.expenseId,
          pushedAt: zohoPushes.pushedAt,
          status: zohoPushes.status,
        })
        .from(zohoPushes)
        .leftJoin(
          zohoOrganizations,
          eq(zohoPushes.organizationId, zohoOrganizations.id),
        )
        .where(
          and(
            inArray(zohoPushes.payrollRunId, runIds),
            eq(zohoPushes.status, "OK"),
          ),
        )
    : [];
  const pushesByRun = new Map<
    string,
    Array<{ orgId: string; orgName: string; expenseId: string | null; pushedAt: Date }>
  >();
  for (const p of pushes) {
    const list = pushesByRun.get(p.payrollRunId) ?? [];
    list.push({
      orgId: p.organizationId,
      orgName: p.orgName ?? "(unknown)",
      expenseId: p.expenseId,
      pushedAt: p.pushedAt,
    });
    pushesByRun.set(p.payrollRunId, list);
  }

  // Bulk-load temp-labor totals per period.
  const periodIds = [...new Set(rows.map((r) => r.periodId))];
  const tempByPeriod = await sumTempByPeriod(periodIds);

  return rows.map((r) => ({
    id: r.id,
    periodId: r.periodId,
    startDate: r.startDate ?? "",
    endDate: r.endDate ?? "",
    source: r.source,
    state: r.state,
    scheduleName: r.scheduleName,
    amountCents: r.totalAmount ?? r.payslipSum,
    tempLaborCents: tempByPeriod.get(r.periodId) ?? 0,
    createdByDisplay: r.createdByName ?? r.approverDisplay ?? "system",
    postedAt: r.postedAt ?? r.publishedAt ?? r.approvedAt ?? r.createdAt,
    publishedToPortalAt: r.publishedToPortalAt,
    pdfPath: r.pdfPath,
    zohoPushes: pushesByRun.get(r.id) ?? [],
  }));
}

export async function getRunWithPeriod(
  id: string,
): Promise<(PayrollRun & { startDate: string; endDate: string; scheduleName: string | null }) | null> {
  const [row] = await db
    .select({
      run: payrollRuns,
      startDate: payPeriods.startDate,
      endDate: payPeriods.endDate,
      scheduleName: paySchedules.name,
    })
    .from(payrollRuns)
    .leftJoin(payPeriods, eq(payrollRuns.periodId, payPeriods.id))
    .leftJoin(paySchedules, eq(payrollRuns.payScheduleId, paySchedules.id))
    .where(eq(payrollRuns.id, id));
  if (!row) return null;
  return {
    ...row.run,
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? "",
    scheduleName: row.scheduleName,
  };
}

export async function deleteRun(
  id: string,
  actor: Actor,
): Promise<void> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id));
    if (!before) throw new Error(`deleteRun: ${id} not found`);
    // Cascade payslips manually since the FK is RESTRICT.
    await tx.delete(payslips).where(eq(payslips.payrollRunId, id));
    await tx.delete(payrollRuns).where(eq(payrollRuns.id, id));
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "payroll_run.delete",
        targetType: "PayrollRun",
        targetId: id,
        before,
      },
      tx,
    );
  });
}

/**
 * Mark a run as published to the employee portal. Sets the timestamp,
 * audits the change, and bumps the run's publishedAt if not already set.
 * Idempotent: a no-op if already published.
 */
export async function publishToPortal(
  id: string,
  actor: Actor,
): Promise<PayrollRun> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, id));
    if (!before) throw new Error(`publishToPortal: ${id} not found`);
    // Don't let admins flip the visibility flag on a run whose payslip
    // generation hasn't completed yet. Without this guard, an APPROVED
    // run where the pg-boss job failed/never ran could be marked
    // "Published" with zero payslips — which is exactly the bug we hit
    // with the 583a12ba shell run.
    if (before.state !== "PUBLISHED") {
      throw new Error(
        `publishToPortal: run ${id} is in state ${before.state}; payslip generation has not completed yet. Approve the run again or use Retry publish.`,
      );
    }
    if (before.publishedToPortalAt) return before;
    const now = new Date();
    const [row] = await tx
      .update(payrollRuns)
      .set({
        publishedToPortalAt: now,
        publishedAt: before.publishedAt ?? now,
      })
      .where(eq(payrollRuns.id, id))
      .returning();
    if (!row) throw new Error("publishToPortal: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "payroll_run.publish_to_portal",
        targetType: "PayrollRun",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function getRun(id: string): Promise<PayrollRun | null> {
  const [row] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id));
  return row ?? null;
}

export async function createRun(
  periodId: string,
  scheduledFor: Date,
  actor: Actor | null = null,
  options: { payScheduleId?: string | null } = {},
): Promise<PayrollRun> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(payrollRuns)
      .values({
        periodId,
        scheduledFor,
        state: "SCHEDULED",
        payScheduleId: options.payScheduleId ?? null,
      })
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
