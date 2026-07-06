// Read + write helpers for payroll_runs.
//
// Phase 2 added: list/get/create + markIngestFailed.
// Phase 3 adds the rest of the state-machine transitions: per spec §6 the
// run progresses SCHEDULED → INGESTING → AWAITING_EMPLOYEE_FIXES (or
// AWAITING_ADMIN_REVIEW) → APPROVED → PUBLISHED, plus terminal failure
// states. transitionRun gates on the legal-edge table.

import { desc, eq, and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payrollRuns,
  payPeriods,
  payslips,
  paySchedules,
  payrollPeriodDocuments,
  employees,
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

/** Sum amountCents on non-deleted PAYSTUB documents per period. */
async function sumDocNetByPeriod(
  periodIds: string[],
): Promise<Map<string, number>> {
  if (periodIds.length === 0) return new Map();
  const rows = await db
    .select({
      periodId: payrollPeriodDocuments.periodId,
      total: sql<number>`COALESCE(SUM(${payrollPeriodDocuments.amountCents}), 0)::int`,
    })
    .from(payrollPeriodDocuments)
    .where(
      and(
        inArray(payrollPeriodDocuments.periodId, periodIds),
        isNull(payrollPeriodDocuments.deletedAt),
        sql`${payrollPeriodDocuments.amountCents} IS NOT NULL`,
      ),
    )
    .groupBy(payrollPeriodDocuments.periodId);
  return new Map(rows.map((r) => [r.periodId!, r.total]));
}

/**
 * Per period, sum the run-payslip net (rounded_pay_cents) for employees who
 * ALSO have a W2 paystub document for that period. The run computes these
 * salaried employees' pay UNTAXED (≈ gross), but the uploaded paystub carries
 * the real take-home — so the period NET replaces this run amount with the
 * paystub net (subtract this, add docNet). Hourly employees (no paystub) keep
 * their run net untouched, so mixed periods stay correct.
 */
async function sumReplacedRunNetByPeriod(
  periodIds: string[],
): Promise<Map<string, number>> {
  if (periodIds.length === 0) return new Map();
  const rows = await db
    .select({
      periodId: payrollRuns.periodId,
      total: sql<number>`COALESCE(SUM(${payslips.roundedPayCents}), 0)::int`,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payslips.payrollRunId, payrollRuns.id))
    .where(
      and(
        inArray(payrollRuns.periodId, periodIds),
        isNull(payslips.voidedAt),
        sql`EXISTS (
          SELECT 1 FROM ${payrollPeriodDocuments} d
          WHERE d.employee_id = ${payslips.employeeId}
            AND d.period_id = ${payrollRuns.periodId}
            AND d.kind = 'PAYSTUB'
            AND d.deleted_at IS NULL
            AND d.amount_cents IS NOT NULL
        )`,
      ),
    )
    .groupBy(payrollRuns.periodId);
  return new Map(rows.map((r) => [r.periodId!, r.total]));
}

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE";
};

export type PayrollRunState = (typeof payrollRunStateEnum.enumValues)[number];

const LEGAL_TRANSITIONS: Record<PayrollRunState, readonly PayrollRunState[]> = {
  SCHEDULED: ["INGESTING", "CANCELLED"],
  INGESTING: ["AWAITING_EMPLOYEE_FIXES", "AWAITING_ADMIN_REVIEW", "INGEST_FAILED"],
  // INGEST_FAILED can recover via a manual CSV upload that lands punches
  // and moves the run forward — without these transitions the run is
  // stuck even though data successfully landed.
  INGEST_FAILED: ["INGESTING", "AWAITING_ADMIN_REVIEW", "AWAITING_EMPLOYEE_FIXES", "CANCELLED"],
  AWAITING_EMPLOYEE_FIXES: ["AWAITING_ADMIN_REVIEW", "CANCELLED"],
  // Self-edge removed — re-asserting the same state is a no-op and
  // shouldn't pollute audit history.
  AWAITING_ADMIN_REVIEW: ["APPROVED", "CANCELLED"],
  APPROVED: ["PUBLISHED", "FAILED"],
  PUBLISHED: [],
  // FAILED can also recover to a recovery review, not just re-ingest.
  FAILED: ["INGESTING", "AWAITING_ADMIN_REVIEW", "CANCELLED"],
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
  /** Sum of gross_pay_cents for this run's payslips. Zero for runs without payslips. */
  grossPayCents: number;
  /** Sum of amountCents on non-deleted PAYSTUB documents for the period.
   *  Represents the after-tax net from accountant-prepared paystubs (W2/
   *  salaried employees). Same value on every run sharing a period. */
  docNetPayCents: number;
  /** Run-payslip net for employees who ALSO have a W2 paystub this period.
   *  The period NET swaps this (untaxed run amount) out for docNetPayCents (the
   *  real take-home). Same value on every run sharing a period. */
  replacedRunNetCents: number;
  /** Sum of (non-deleted) temp_worker_entries for the period. Same value for
   *  every run sharing a period; UI is responsible for displaying once. */
  tempLaborCents: number;
  createdByDisplay: string;
  postedAt: Date;
  publishedToPortalAt: Date | null;
  pdfPath: string | null;
  zohoPushes: Array<{ orgId: string; orgName: string; expenseId: string | null; pushedAt: Date }>;
  /** State of the underlying pay_period (OPEN / LOCKED / PAID). Drives
   *  the "Pay from cash drawer" affordance — only LOCKED can transition
   *  to PAID. */
  periodState: "OPEN" | "LOCKED" | "PAID";
  /** When state = PAID, how it was settled. NULL for older periods or
   *  ones that haven't been paid yet. */
  periodPaymentMethod: "BANK" | "CASH" | null;
  /** True for synthetic rows that represent salaried W2 paystub uploads with
   *  no payroll run (the Salaried-tab flow). The reports UI renders these as a
   *  simple "Salaried" period line (View paystub, no run actions). */
  isSalariedPaystub?: boolean;
  /** Per-employee paystub breakdown for a salaried-paystub row. */
  paystubDocs?: Array<{ id: string; employeeName: string; amountCents: number }>;
};

/**
 * Salaried W2 paystubs carry the real pay for employees whose pay is
 * prepared externally, and a payroll RUN is the only other thing that puts
 * a period on the Reports page. So a paystub doc must surface here whenever
 * its period has no run to represent it:
 *
 *   - docs uploaded via the Salaried tab (periodId NULL — no period row), and
 *   - docs attached to a pay period that never got a payroll run. Without
 *     this, locking + marking such a period PAID made the pay INVISIBLE
 *     everywhere: /payroll hides PAID periods by design ("history lives in
 *     /reports") and /reports had nothing to show for a run-less period.
 *
 * Docs on run-backed periods are excluded — listReports already folds them
 * in via docNetPayCents (the W2 net swap), so listing them here would
 * double-count. Rows group per (start,end) pay period, summing every
 * employee's net, and flow into the reports month-total.
 */
export async function listSalariedPaystubReports(
  limit = 200,
): Promise<ReportRow[]> {
  const docs = await db
    .select({
      id: payrollPeriodDocuments.id,
      start: payrollPeriodDocuments.payPeriodStart,
      end: payrollPeriodDocuments.payPeriodEnd,
      amountCents: payrollPeriodDocuments.amountCents,
      uploadedAt: payrollPeriodDocuments.uploadedAt,
      employeeName: employees.displayName,
      periodId: payrollPeriodDocuments.periodId,
      periodState: payPeriods.state,
      periodPaymentMethod: payPeriods.paymentMethod,
    })
    .from(payrollPeriodDocuments)
    .leftJoin(employees, eq(payrollPeriodDocuments.employeeId, employees.id))
    .leftJoin(payPeriods, eq(payrollPeriodDocuments.periodId, payPeriods.id))
    .where(
      and(
        eq(payrollPeriodDocuments.kind, "PAYSTUB"),
        isNull(payrollPeriodDocuments.deletedAt),
        sql`${payrollPeriodDocuments.amountCents} IS NOT NULL`,
        sql`${payrollPeriodDocuments.payPeriodStart} IS NOT NULL`,
        sql`${payrollPeriodDocuments.payPeriodEnd} IS NOT NULL`,
        sql`(${payrollPeriodDocuments.periodId} IS NULL OR NOT EXISTS (
          SELECT 1 FROM ${payrollRuns}
          WHERE ${payrollRuns.periodId} = ${payrollPeriodDocuments.periodId}
        ))`,
      ),
    )
    .orderBy(desc(payrollPeriodDocuments.payPeriodEnd));

  // Group by the (start,end) pay period.
  const byPeriod = new Map<
    string,
    {
      start: string;
      end: string;
      total: number;
      latestUpload: Date;
      periodId: string | null;
      periodState: "OPEN" | "LOCKED" | "PAID" | null;
      periodPaymentMethod: "BANK" | "CASH" | null;
      docs: Array<{ id: string; employeeName: string; amountCents: number }>;
    }
  >();
  for (const d of docs) {
    if (!d.start || !d.end || d.amountCents === null) continue;
    const key = `${d.start}__${d.end}`;
    const g = byPeriod.get(key) ?? {
      start: d.start,
      end: d.end,
      total: 0,
      latestUpload: d.uploadedAt,
      periodId: null,
      periodState: null,
      periodPaymentMethod: null,
      docs: [],
    };
    g.total += d.amountCents;
    if (d.uploadedAt > g.latestUpload) g.latestUpload = d.uploadedAt;
    if (d.periodId && !g.periodId) {
      g.periodId = d.periodId;
      g.periodState = d.periodState;
      g.periodPaymentMethod = d.periodPaymentMethod;
    }
    g.docs.push({
      id: d.id,
      employeeName: d.employeeName ?? "Salaried employee",
      amountCents: d.amountCents,
    });
    byPeriod.set(key, g);
  }

  return [...byPeriod.values()]
    .slice(0, limit)
    .map((g) => ({
      id: `salaried-paystub:${g.start}:${g.end}`,
      // Real period id when the docs are period-attached, so the reports
      // line can link back to the period page; synthetic key otherwise.
      periodId: g.periodId ?? `salaried-paystub:${g.start}:${g.end}`,
      startDate: g.start,
      endDate: g.end,
      source: "AD_HOC" as PayrollRun["source"],
      state: "PUBLISHED" as PayrollRun["state"],
      scheduleName: "Salaried",
      amountCents: g.total,
      grossPayCents: 0,
      docNetPayCents: 0,
      replacedRunNetCents: 0,
      tempLaborCents: 0,
      createdByDisplay: "Salaried upload",
      postedAt: g.latestUpload,
      publishedToPortalAt: null,
      pdfPath: null,
      zohoPushes: [],
      // Period-attached docs report their period's real state; the legacy
      // Salaried-tab flow has no period row and keeps its PAID default.
      periodState: g.periodState ?? ("PAID" as const),
      periodPaymentMethod: g.periodPaymentMethod ?? (g.periodId ? null : ("BANK" as const)),
      isSalariedPaystub: true,
      paystubDocs: g.docs,
    }));
}

export async function listReports(
  limit = 100,
  /**
   * Filter by pay-schedule kind. WEEKLY / SEMI_MONTHLY / MONTHLY map to
   * paySchedules.periodKind directly. "SALARIED" has no period_kind of its
   * own (the enum only covers WEEKLY/BIWEEKLY/SEMI_MONTHLY/MONTHLY), so it
   * matches runs whose schedule name does NOT read as a recurring cadence
   * (or has no schedule attached) — the same classification the Reports
   * overview donut uses in lib/reports/reports-overview.ts (cadenceOf).
   * Pass `null` (default) to return everything including legacy runs with
   * no schedule attached.
   */
  scheduleKind: "WEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | "SALARIED" | null = null,
): Promise<ReportRow[]> {
  const baseQuery = db
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
      grossPaySum: sql<number>`COALESCE((
        SELECT SUM(${payslips.grossPayCents})::int
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
      periodState: payPeriods.state,
      periodPaymentMethod: payPeriods.paymentMethod,
    })
    .from(payrollRuns)
    .leftJoin(payPeriods, eq(payrollRuns.periodId, payPeriods.id))
    .leftJoin(paySchedules, eq(payrollRuns.payScheduleId, paySchedules.id))
    .leftJoin(users, eq(payrollRuns.approvedById, users.id));
  // Sort by the actual period the run pays out, newest first.
  // WEEKLY/SEMI_MONTHLY/MONTHLY filter on the schedule's period_kind enum.
  // "SALARIED" is synthetic: it has no period_kind, so match it the way the
  // Reports overview donut classifies cadence (reports-overview.ts → cadenceOf)
  // — a run is salaried when its schedule name does NOT read as a recurring
  // cadence (no semi/twice/bi-month/week/month), or has no schedule at all.
  // Keeping the two in lock-step is what makes the Salaried tab show exactly
  // the runs the donut counts as Salaried.
  let filtered;
  if (scheduleKind === "SALARIED") {
    const name = sql`LOWER(COALESCE(${paySchedules.name}, ''))`;
    filtered = baseQuery.where(
      sql`${name} NOT LIKE '%semi%'
        AND ${name} NOT LIKE '%twice%'
        AND ${name} NOT LIKE '%bi-month%'
        AND ${name} NOT LIKE '%week%'
        AND ${name} NOT LIKE '%month%'`,
    );
  } else if (scheduleKind) {
    filtered = baseQuery.where(eq(paySchedules.periodKind, scheduleKind));
  } else {
    filtered = baseQuery;
  }
  const rows = await filtered
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

  // Bulk-load temp-labor and document-net totals per period.
  const periodIds = [...new Set(rows.map((r) => r.periodId))];
  const [tempByPeriod, docNetByPeriod, replacedRunNetByPeriod] = await Promise.all([
    sumTempByPeriod(periodIds),
    sumDocNetByPeriod(periodIds),
    sumReplacedRunNetByPeriod(periodIds),
  ]);

  return rows.map((r) => ({
    id: r.id,
    periodId: r.periodId,
    startDate: r.startDate ?? "",
    endDate: r.endDate ?? "",
    source: r.source,
    state: r.state,
    scheduleName: r.scheduleName,
    // Prefer the live payslipSum over the stored total_amount_cents.
    // Many legacy-import runs were stamped with the source file's
    // grand-total which sometimes drifted from reality (re-imports,
    // partial migrations) — the audit found 54 such runs with deltas
    // up to $5k. The actual payslip rows are the source of truth, so
    // use them when present. Fall back to the stored total only when
    // there are no payslips on the run (e.g. cohort-empty shells).
    amountCents:
      r.payslipSum > 0 ? r.payslipSum : r.totalAmount ?? 0,
    grossPayCents: r.grossPaySum ?? 0,
    docNetPayCents: docNetByPeriod.get(r.periodId ?? "") ?? 0,
    replacedRunNetCents: replacedRunNetByPeriod.get(r.periodId ?? "") ?? 0,
    tempLaborCents: tempByPeriod.get(r.periodId) ?? 0,
    createdByDisplay: r.createdByName ?? r.approverDisplay ?? "system",
    postedAt: r.postedAt ?? r.publishedAt ?? r.approvedAt ?? r.createdAt,
    publishedToPortalAt: r.publishedToPortalAt,
    pdfPath: r.pdfPath,
    zohoPushes: pushesByRun.get(r.id) ?? [],
    periodState: (r.periodState ?? "OPEN") as "OPEN" | "LOCKED" | "PAID",
    periodPaymentMethod: (r.periodPaymentMethod ?? null) as
      | "BANK"
      | "CASH"
      | null,
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
    // Per CLAUDE.md soft-delete spec, refuse to hard-delete a PUBLISHED
    // run — payslip history is owed to employees and accountants. Move
    // through CANCELLED first (or use voidPayslip on individual rows).
    if (before.state === "PUBLISHED") {
      throw new Error(
        "Cannot delete a PUBLISHED run. Cancel it first via the run detail page, or void specific payslips, then retry.",
      );
    }
    // For non-PUBLISHED runs (failed ingest, abandoned drafts, cancelled
    // runs) the payslips are never-published draft scaffolding — no
    // acknowledged history to preserve (PUBLISHED is blocked above). They must
    // be HARD-deleted before the run: the payslips.payrollRunId FK is ON DELETE
    // RESTRICT, so merely voiding them (a column update, not a row removal)
    // left the children referencing the run and made `delete(payrollRuns)`
    // throw a foreign-key violation every time — the run could never be deleted.
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

