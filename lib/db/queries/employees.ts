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
  users,
  type Employee,
  type NewEmployee,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import {
  looksLikeDoubledAvatarName,
  sanitizeNgtecoPersonName,
} from "@/lib/ngteco/person-name";
import { NGTECO_SETUP_IGNORED_TAG } from "@/lib/ngteco/employee-roster-sync";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE";
};

export type EmployeeListFilters = {
  status?: "ACTIVE" | "INACTIVE" | "TERMINATED";
  /**
   * When true, terminated employees are excluded from the result regardless
   * of `status`. The Employees page uses this for its default + "All" views
   * so terminated staff only surface under the explicit Terminated tab.
   */
  excludeTerminated?: boolean;
  shiftId?: string;
  search?: string;
  /**
   * Cohort filter for payroll runs:
   *   - string  → employees on this exact pay schedule
   *   - "none"  → employees without any schedule (employees.pay_schedule_id IS NULL)
   *   - undefined → no filter
   *
   * `payScheduleIdOrNull`: same shape as the exact-match form, but ALSO
   * matches employees with NULL pay_schedule_id (legacy ride-along).
   * Use this everywhere the upload action's manual-import treats null as
   * a wildcard — publish handler, run-detail, admin-report, period-detail.
   */
  payScheduleId?: string | "none";
  payScheduleIdOrNull?: string;
};

export async function listEmployees(
  filters: EmployeeListFilters = {},
): Promise<Employee[]> {
  const conditions = [];
  if (filters.status) conditions.push(eq(employees.status, filters.status));
  if (filters.excludeTerminated)
    conditions.push(sql`${employees.status} <> 'TERMINATED'`);
  if (filters.shiftId) conditions.push(eq(employees.shiftId, filters.shiftId));
  if (filters.payScheduleId === "none") {
    conditions.push(sql`${employees.payScheduleId} IS NULL`);
  } else if (filters.payScheduleId) {
    conditions.push(eq(employees.payScheduleId, filters.payScheduleId));
  } else if (filters.payScheduleIdOrNull) {
    conditions.push(
      sql`(${employees.payScheduleId} = ${filters.payScheduleIdOrNull} OR ${employees.payScheduleId} IS NULL)`,
    );
  }
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

/** Hourly/flat-task employees need rate + pay schedule before going active. */
export function activationRequirementsMessage(input: {
  payType: Employee["payType"];
  payScheduleId: string | null;
  hourlyRateCents: number | null;
}): string | null {
  if (input.payType === "SALARIED") return null;
  if (!input.payScheduleId) {
    return "Choose a classification with an active pay schedule before activating.";
  }
  if (input.hourlyRateCents == null) {
    return "Set an hourly rate before activating.";
  }
  return null;
}

export async function getEmployee(id: string): Promise<Employee | null> {
  const [row] = await db.select().from(employees).where(eq(employees.id, id));
  return row ?? null;
}

/** Inactive stubs auto-imported from NGTeco that still need rate/schedule. */
export async function listEmployeesNeedingNgtecoSetup(): Promise<Employee[]> {
  const rows = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.status, "INACTIVE"),
        sql`${employees.ngtecoEmployeeRef} IS NOT NULL`,
        sql`(${employees.payScheduleId} IS NULL OR ${employees.hourlyRateCents} IS NULL)`,
        sql`${employees.notes} LIKE 'NGTECO_IMPORT:%'`,
        sql`${employees.notes} NOT LIKE ${`%${NGTECO_SETUP_IGNORED_TAG}%`}`,
      ),
    );

  const repaired: Employee[] = [];
  for (const row of rows) {
    if (!looksLikeDoubledAvatarName(row.displayName)) {
      repaired.push(row);
      continue;
    }
    const fixed = sanitizeNgtecoPersonName(row.displayName);
    if (fixed === row.displayName) {
      repaired.push(row);
      continue;
    }
    const [updated] = await db
      .update(employees)
      .set({
        displayName: fixed,
        legalName: fixed,
        updatedAt: new Date(),
      })
      .where(eq(employees.id, row.id))
      .returning();
    repaired.push(updated ?? { ...row, displayName: fixed, legalName: fixed });
  }

  return repaired.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function ignoreNgtecoSetupEmployee(
  employeeId: string,
  actor: Actor,
): Promise<Employee> {
  const emp = await getEmployee(employeeId);
  if (!emp) throw new Error("Employee not found.");
  if (!emp.notes?.includes("NGTECO_IMPORT:")) {
    throw new Error("Only NGTeco auto-imports can be dismissed from setup.");
  }
  const notes = emp.notes.includes(NGTECO_SETUP_IGNORED_TAG)
    ? emp.notes
    : `${emp.notes} ${NGTECO_SETUP_IGNORED_TAG}`.trim();

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(employees)
      .set({ notes, updatedAt: new Date() })
      .where(eq(employees.id, employeeId))
      .returning();
    if (!row) throw new Error("ignoreNgtecoSetupEmployee: update failed");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "employee.update",
        targetType: "Employee",
        targetId: employeeId,
        before: emp,
        after: row,
      },
      tx,
    );
    return row;
  });
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

// Whitelist of mutable fields. Defends against a future caller that
// builds a patch from arbitrary form input — e.g. the employee-side
// /me/profile action passing through a pay-rate field. Anything not in
// this set is silently dropped from the update set.
const UPDATABLE_FIELDS = new Set<keyof UpdateEmployeePatch>([
  "displayName",
  "legalName",
  "email",
  "phone",
  "shiftId",
  "payType",
  "payScheduleId",
  "hourlyRateCents",
  "language",
  "notes",
  "ngtecoEmployeeRef",
  "legacyId",
  "hiredOn",
  "status",
  "requiresW2Upload",
  "birthday",
  "zohoExpenseAccount",
  "zohoPaidThrough",
  "kioskPinHash",
]);

function whitelistPatch(patch: UpdateEmployeePatch): UpdateEmployeePatch {
  const out: UpdateEmployeePatch = {};
  for (const k of Object.keys(patch) as (keyof UpdateEmployeePatch)[]) {
    if (UPDATABLE_FIELDS.has(k)) {
      // Type system can't narrow here; runtime check above is the gate.
      (out as Record<string, unknown>)[k] = (patch as Record<string, unknown>)[k];
    }
  }
  return out;
}

export async function updateEmployee(
  id: string,
  patch: UpdateEmployeePatch,
  actor: Actor,
): Promise<Employee> {
  const cleanPatch = whitelistPatch(patch);
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(employees)
      .where(eq(employees.id, id));
    if (!before) throw new Error(`updateEmployee: employee ${id} not found`);
    const [row] = await tx
      .update(employees)
      .set({ ...cleanPatch, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning();
    if (!row) throw new Error("updateEmployee: returning() empty");
    // If the employee has a linked User, keep its login email in sync with
    // the employee's email — admins set it on the Employee form and expect
    // the same address to appear on the Account section.
    if (cleanPatch.email && cleanPatch.email !== before.email) {
      const [linkedUser] = await tx
        .select()
        .from(users)
        .where(eq(users.employeeId, id));
      if (linkedUser && linkedUser.email !== cleanPatch.email) {
        await tx
          .update(users)
          .set({ email: cleanPatch.email, updatedAt: new Date() })
          .where(eq(users.id, linkedUser.id));
        await writeAudit(
          {
            actorId: actor.id,
            actorRole: actor.role,
            action: "user.email_sync_from_employee",
            targetType: "User",
            targetId: linkedUser.id,
            before: { email: linkedUser.email },
            after: { email: cleanPatch.email },
          },
          tx,
        );
      }
    }
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
    // Disable the linked user so a terminated employee can't keep
    // logging in to /me. Without this their session stays valid until
    // it expires naturally.
    const [linkedUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.employeeId, id));
    if (linkedUser) {
      await tx
        .update(users)
        .set({ disabledAt: new Date() })
        .where(eq(users.id, linkedUser.id));
    }
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "employee.archive",
        targetType: "Employee",
        targetId: id,
        before,
        after: { ...row, linkedUserDisabled: !!linkedUser },
      },
      tx,
    );
    return row;
  });
}

