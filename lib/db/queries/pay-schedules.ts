// Pay-schedule queries. Owner CRUDs these from /admin/settings/pay-schedules.
// Each Employee is assigned exactly one (employees.pay_schedule_id), and the
// payroll.run.tick job fires per schedule's cron — only including employees
// on that schedule.

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  paySchedules,
  employees,
  payrollRuns,
  type PaySchedule,
  type NewPaySchedule,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE";
};

export type ScheduleKind = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY";

export const DEFAULT_WEEKLY_NAME = "Weekly";
export const DEFAULT_SEMI_MONTHLY_NAME = "Semi-Monthly";
export const DEFAULT_MONTHLY_NAME = "Monthly";

export async function listSchedules(
  options: { includeInactive?: boolean } = {},
): Promise<PaySchedule[]> {
  const rows = options.includeInactive
    ? await db.select().from(paySchedules).orderBy(asc(paySchedules.name))
    : await db
        .select()
        .from(paySchedules)
        .where(eq(paySchedules.active, true))
        .orderBy(asc(paySchedules.name));
  return rows;
}


export async function createSchedule(
  input: Omit<NewPaySchedule, "id" | "createdAt" | "updatedAt">,
  actor: Actor,
): Promise<PaySchedule> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(paySchedules).values(input).returning();
    if (!row) throw new Error("createSchedule: insert returned no row");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "pay_schedule.create",
        targetType: "PaySchedule",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export type UpdateSchedulePatch = Partial<
  Omit<NewPaySchedule, "id" | "createdAt" | "updatedAt">
>;

export async function updateSchedule(
  id: string,
  patch: UpdateSchedulePatch,
  actor: Actor,
): Promise<PaySchedule> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(paySchedules)
      .where(eq(paySchedules.id, id));
    if (!before) throw new Error(`updateSchedule: ${id} not found`);
    const [row] = await tx
      .update(paySchedules)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(paySchedules.id, id))
      .returning();
    if (!row) throw new Error("updateSchedule: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "pay_schedule.update",
        targetType: "PaySchedule",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

/**
 * Counts of employees per schedule, used by the Settings tab to show usage.
 */
export async function countEmployeesPerSchedule(): Promise<
  Record<string, number>
> {
  const rows = await db
    .select({
      scheduleId: employees.payScheduleId,
      n: sql<number>`count(*)::int`,
    })
    .from(employees)
    .where(and(eq(employees.status, "ACTIVE")))
    .groupBy(employees.payScheduleId);
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.scheduleId) out[r.scheduleId] = r.n;
  }
  return out;
}

/**
 * Any payroll_runs already pinned to this schedule. Used by the Settings tab
 * to warn before deactivating a schedule that still has historic runs.
 */
export async function countRunsForSchedule(scheduleId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payrollRuns)
    .where(eq(payrollRuns.payScheduleId, scheduleId));
  return row?.n ?? 0;
}
