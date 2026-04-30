// Employee queries. Soft-delete only — `archiveEmployee` flips status to
// TERMINATED and never DELETEs.
//
// All mutations run inside a transaction with the audit insert; if audit
// fails, the mutation rolls back.

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees,
  employeeRateHistory,
  type Employee,
  type NewEmployee,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

export type EmployeeListFilters = {
  status?: "ACTIVE" | "INACTIVE" | "TERMINATED";
  shiftId?: string;
  search?: string;
};

export async function listEmployees(
  filters: EmployeeListFilters = {},
): Promise<Employee[]> {
  const conditions = [];
  if (filters.status) conditions.push(eq(employees.status, filters.status));
  if (filters.shiftId) conditions.push(eq(employees.shiftId, filters.shiftId));
  if (filters.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      or(
        ilike(employees.displayName, term),
        ilike(employees.legalName, term),
        ilike(employees.email, term),
      ),
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const query = db.select().from(employees);
  const rows = where ? await query.where(where) : await query;
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const [row] = await db.select().from(employees).where(eq(employees.id, id));
  return row ?? null;
}

export type CreateEmployeeInput = Omit<
  NewEmployee,
  "id" | "createdAt" | "updatedAt" | "hourlyRateCents"
> & {
  /** Cents/hour for the initial rate-history row. Optional for FLAT_TASK. */
  initialHourlyRateCents?: number | null;
  /** YYYY-MM-DD; defaults to hiredOn when omitted. */
  initialRateEffectiveFrom?: string;
};

export async function createEmployee(
  input: CreateEmployeeInput,
  actor: Actor,
): Promise<Employee> {
  const {
    initialHourlyRateCents,
    initialRateEffectiveFrom,
    ...employeeFields
  } = input;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(employees)
      .values({
        ...employeeFields,
        hourlyRateCents:
          initialHourlyRateCents !== undefined &&
          initialHourlyRateCents !== null
            ? initialHourlyRateCents
            : null,
      })
      .returning();
    if (!row) throw new Error("createEmployee: insert returned no row");
    if (
      initialHourlyRateCents !== undefined &&
      initialHourlyRateCents !== null
    ) {
      await tx.insert(employeeRateHistory).values({
        employeeId: row.id,
        effectiveFrom: initialRateEffectiveFrom ?? row.hiredOn,
        hourlyRateCents: initialHourlyRateCents,
        changedById: actor.id,
        reason: "Initial rate at hire",
      });
    }
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "employee.create",
        targetType: "Employee",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export type UpdateEmployeePatch = Partial<
  Omit<NewEmployee, "id" | "createdAt" | "updatedAt">
>;

export async function updateEmployee(
  id: string,
  patch: UpdateEmployeePatch,
  actor: Actor,
): Promise<Employee> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, id));
    if (!before) throw new Error(`updateEmployee: employee ${id} not found`);
    const [row] = await tx
      .update(employees)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    if (!row) throw new Error("updateEmployee: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "employee.update",
        targetType: "Employee",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function archiveEmployee(
  id: string,
  reason: string,
  actor: Actor,
): Promise<Employee> {
  if (!reason.trim()) {
    throw new Error("archiveEmployee: reason is required");
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, id));
    if (!before) throw new Error(`archiveEmployee: employee ${id} not found`);
    const [row] = await tx
      .update(employees)
      .set({
        status: "TERMINATED",
        notes: before.notes
          ? `${before.notes}\n[${new Date().toISOString()}] terminated: ${reason}`
          : `[${new Date().toISOString()}] terminated: ${reason}`,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, id))
      .returning();
    if (!row) throw new Error("archiveEmployee: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "employee.archive",
        targetType: "Employee",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function countActiveEmployees(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(employees)
    .where(eq(employees.status, "ACTIVE"));
  return row?.n ?? 0;
}

export async function listRecentlyUpdated(limit = 10): Promise<Employee[]> {
  return db
    .select()
    .from(employees)
    .orderBy(desc(employees.updatedAt))
    .limit(limit);
}
