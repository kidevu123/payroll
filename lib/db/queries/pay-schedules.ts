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
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

export type ScheduleKind = "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY";

export const DEFAULT_WEEKLY_NAME = "Weekly";
export const DEFAULT_SEMI_MONTHLY_NAME = "Semi-Monthly";

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

export async function getSchedule(id: string): Promise<PaySchedule | null> {
  const [row] = await db
    .select()
    .from(paySchedules)
    .where(eq(paySchedules.id, id));
  return row ?? null;
}

export async function getScheduleByName(
  name: string,
): Promise<PaySchedule | null> {
  const [row] = await db
    .select()
    .from(paySchedules)
    .where(eq(paySchedules.name, name));
  return row ?? null;
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

export async function deactivateSchedule(
  id: string,
  actor: Actor,
): Promise<void> {
  await updateSchedule(id, { active: false }, actor);
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
 * Active employees on a given schedule. Used by the run-tick job to scope
 * which employees a freshly-created PayrollRun should include.
 */
export async function listEmployeesOnSchedule(
  scheduleId: string,
): Promise<{ id: string; displayName: string }[]> {
  return db
    .select({ id: employees.id, displayName: employees.displayName })
    .from(employees)
    .where(
      and(
        eq(employees.payScheduleId, scheduleId),
        eq(employees.status, "ACTIVE"),
      ),
    );
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
