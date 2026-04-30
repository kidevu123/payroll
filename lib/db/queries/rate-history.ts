// Rate history queries.
//
// `addRate` writes a versioned rate row AND keeps the denormalized
// `employees.hourlyRateCents` cache in sync with whichever rate is now the
// most recent (by effectiveFrom). Past-dated rate corrections are allowed,
// with the audit row recording the reason.

import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employeeRateHistory,
  employees,
  type EmployeeRateHistoryRow,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import type { Actor } from "./employees";

export async function listRates(
  employeeId: string,
): Promise<EmployeeRateHistoryRow[]> {
  return db
    .select()
    .from(employeeRateHistory)
    .where(eq(employeeRateHistory.employeeId, employeeId))
    .orderBy(desc(employeeRateHistory.effectiveFrom));
}

/** Rate effective at a given YYYY-MM-DD. Null if no rate covers that day. */
export async function rateAt(
  employeeId: string,
  on: string,
): Promise<EmployeeRateHistoryRow | null> {
  const [row] = await db
    .select()
    .from(employeeRateHistory)
    .where(
      and(
        eq(employeeRateHistory.employeeId, employeeId),
        lte(employeeRateHistory.effectiveFrom, on),
      ),
    )
    .orderBy(desc(employeeRateHistory.effectiveFrom))
    .limit(1);
  return row ?? null;
}

export type AddRateInput = {
  effectiveFrom: string; // YYYY-MM-DD
  hourlyRateCents: number;
  reason?: string;
};

export async function addRate(
  employeeId: string,
  input: AddRateInput,
  actor: Actor,
): Promise<EmployeeRateHistoryRow> {
  if (input.hourlyRateCents < 0) {
    throw new Error("addRate: hourlyRateCents must be >= 0");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(employeeRateHistory)
      .values({
        employeeId,
        effectiveFrom: input.effectiveFrom,
        hourlyRateCents: input.hourlyRateCents,
        changedById: actor.id,
        reason: input.reason ?? null,
      })
      .returning();
    if (!row) throw new Error("addRate: insert returned no row");

    // Update the denormalized cache iff this is now the most recent rate.
    const [latest] = await tx
      .select()
      .from(employeeRateHistory)
      .where(eq(employeeRateHistory.employeeId, employeeId))
      .orderBy(desc(employeeRateHistory.effectiveFrom))
      .limit(1);
    if (latest && latest.id === row.id) {
      await tx
        .update(employees)
        .set({
          hourlyRateCents: input.hourlyRateCents,
          updatedAt: new Date(),
        })
        .where(eq(employees.id, employeeId));
    }

    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "rate.add",
        targetType: "EmployeeRateHistory",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}
