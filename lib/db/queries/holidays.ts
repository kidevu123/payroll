// Holiday lookups + CRUD. Used by missed-punch detection and the
// Settings → Holidays tab.

import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { holidays, type Holiday } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

export async function listHolidaysInRange(
  startDate: string,
  endDate: string,
): Promise<Holiday[]> {
  return db
    .select()
    .from(holidays)
    .where(and(gte(holidays.date, startDate), lte(holidays.date, endDate)));
}

export async function listAllHolidays(): Promise<Holiday[]> {
  return db.select().from(holidays).orderBy(asc(holidays.date));
}

export async function createHoliday(
  date: string,
  label: string,
  actor: Actor,
): Promise<Holiday> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(holidays).values({ date, label }).returning();
    if (!row) throw new Error("createHoliday: insert returned no row");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "holiday.create",
        targetType: "Holiday",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function deleteHoliday(id: string, actor: Actor): Promise<void> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(holidays).where(eq(holidays.id, id));
    if (!before) return;
    await tx.delete(holidays).where(eq(holidays.id, id));
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "holiday.delete",
        targetType: "Holiday",
        targetId: id,
        before,
      },
      tx,
    );
  });
}
