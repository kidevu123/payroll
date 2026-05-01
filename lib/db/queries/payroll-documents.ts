// Per-(period, employee) document artefacts. Used for W2 / paystub uploads
// when the employee's pay is prepared externally (accountant) and the admin
// uploads the resulting PDF/image for the employee to view.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  payrollPeriodDocuments,
  type PayrollPeriodDocument,
  type NewPayrollPeriodDocument,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import type { Actor } from "./employees";

export type ListDocsFilters = {
  periodId?: string;
  employeeId?: string;
  includeDeleted?: boolean;
};

export async function listDocs(
  filters: ListDocsFilters = {},
): Promise<PayrollPeriodDocument[]> {
  const conds = [];
  if (filters.periodId)
    conds.push(eq(payrollPeriodDocuments.periodId, filters.periodId));
  if (filters.employeeId)
    conds.push(eq(payrollPeriodDocuments.employeeId, filters.employeeId));
  if (!filters.includeDeleted)
    conds.push(isNull(payrollPeriodDocuments.deletedAt));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const q = db.select().from(payrollPeriodDocuments);
  const rows = where ? await q.where(where) : await q;
  return rows.sort(
    (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
  );
}

export async function getDoc(
  id: string,
): Promise<PayrollPeriodDocument | null> {
  const [row] = await db
    .select()
    .from(payrollPeriodDocuments)
    .where(eq(payrollPeriodDocuments.id, id));
  return row ?? null;
}

export type CreateDocInput = Omit<
  NewPayrollPeriodDocument,
  "id" | "uploadedAt" | "deletedAt" | "deletedById"
>;

export async function createDoc(
  input: CreateDocInput,
  actor: Actor,
): Promise<PayrollPeriodDocument> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(payrollPeriodDocuments)
      .values(input)
      .returning();
    if (!row) throw new Error("createDoc: insert returned no row");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "payroll_period_document.create",
        targetType: "PayrollPeriodDocument",
        targetId: row.id,
        after: {
          ...row,
          // Don't write the full path to audit — keep filename only.
          filePath: undefined,
        },
      },
      tx,
    );
    return row;
  });
}

export async function deleteDoc(
  id: string,
  actor: Actor,
): Promise<PayrollPeriodDocument> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(payrollPeriodDocuments)
      .where(eq(payrollPeriodDocuments.id, id));
    if (!before) throw new Error(`deleteDoc: ${id} not found`);
    if (before.deletedAt) return before;
    const [row] = await tx
      .update(payrollPeriodDocuments)
      .set({ deletedAt: new Date(), deletedById: actor.id })
      .where(eq(payrollPeriodDocuments.id, id))
      .returning();
    if (!row) throw new Error("deleteDoc: returning() empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "payroll_period_document.delete",
        targetType: "PayrollPeriodDocument",
        targetId: id,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function listEmployeeVisibleDocs(
  employeeId: string,
): Promise<PayrollPeriodDocument[]> {
  return db
    .select()
    .from(payrollPeriodDocuments)
    .where(
      and(
        eq(payrollPeriodDocuments.employeeId, employeeId),
        eq(payrollPeriodDocuments.visibleToEmployee, true),
        isNull(payrollPeriodDocuments.deletedAt),
      ),
    )
    .orderBy(desc(payrollPeriodDocuments.uploadedAt));
}
