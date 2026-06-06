import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { punches } from "@/lib/db/schema";
import { DUPLICATE_PUNCH_WINDOW_MS } from "./pair-events";

/**
 * Void false "ambiguous:single" rows created when app + device both fired at
 * clock-out. The real shift is already stored as a complete in/out pair.
 */
export async function voidSupersededAmbiguousPunches(
  empId: string,
  day: string,
): Promise<number> {
  const dayStart = new Date(`${day}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const dayRows = await db
    .select({
      id: punches.id,
      clockIn: punches.clockIn,
      clockOut: punches.clockOut,
      notes: punches.notes,
      voidedAt: punches.voidedAt,
    })
    .from(punches)
    .where(
      and(
        eq(punches.employeeId, empId),
        sql`${punches.clockIn} >= ${dayStart.toISOString()}::timestamptz`,
        sql`${punches.clockIn} < ${dayEnd.toISOString()}::timestamptz`,
        sql`${punches.voidedAt} IS NULL`,
      ),
    );

  const closed = dayRows.filter(
    (r) =>
      r.clockOut !== null &&
      !(typeof r.notes === "string" && r.notes.includes("ambiguous:single")),
  );

  let voided = 0;
  for (const row of dayRows) {
    if (
      row.voidedAt !== null ||
      typeof row.notes !== "string" ||
      !row.notes.includes("ambiguous:single")
    ) {
      continue;
    }
    const ambMs = row.clockIn.getTime();
    const superseded = closed.some((c) => {
      const outMs = c.clockOut!.getTime();
      return Math.abs(outMs - ambMs) <= DUPLICATE_PUNCH_WINDOW_MS;
    });
    if (!superseded) continue;
    await db
      .update(punches)
      .set({
        voidedAt: new Date(),
        notes: `${row.notes} · auto:void_dup_out`,
      })
      .where(eq(punches.id, row.id));
    voided++;
  }
  return voided;
}
