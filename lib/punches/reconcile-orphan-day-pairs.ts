// When morning and evening polls each see only one NGTeco event, the importer
// stores two ambiguous:single rows instead of one in/out pair. This pass walks
// an employee's punches for a calendar day and merges obvious orphans.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { punches } from "@/lib/db/schema";
import { DUPLICATE_PUNCH_WINDOW_MS } from "./pair-events";
import { isAmbiguousSinglePunch } from "./missing-punch";
import { localDayBoundsForPollImport } from "./poll-importer";

const MAX_PAIR_SPAN_MS = 16 * 60 * 60 * 1000;

type DayPunch = {
  id: string;
  clockIn: Date;
  clockOut: Date | null;
  notes: string | null;
};

/**
 * Only a genuine "ambiguous single" (a lone NGTeco punch the importer couldn't
 * label in vs out) is an orphan this pass may pair or dedup. A real in-progress
 * OPEN shift (open, but NOT ambiguous:single — the employee is clocked in and
 * still working) must be left alone; the importer closes it when the actual
 * clock-out arrives. The old clauses (`notes === null || !notes.includes(
 * "missing:in")`) matched almost any open punch, so they swept up live shifts
 * and fused/deleted them — silently destroying real punches. Exported for tests.
 */
export function isOrphanCandidate(row: DayPunch): boolean {
  // isAmbiguousSinglePunch already requires clockOut === null.
  return isAmbiguousSinglePunch(row);
}

function cleanedNotes(notes: string | null): string {
  if (!notes) return "paired:reconcile";
  return notes
    .replace(/\bambiguous:single\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merge same-day orphan punches (typically two ambiguous:single rows) into
 * complete in/out pairs. Returns the number of rows voided as duplicates.
 */
export async function reconcileOrphanDayPairs(
  empId: string,
  day: string,
  timezone: string,
): Promise<number> {
  const { dayStart, dayEnd } = localDayBoundsForPollImport(day, timezone);

  const dayRows = await db
    .select({
      id: punches.id,
      clockIn: punches.clockIn,
      clockOut: punches.clockOut,
      notes: punches.notes,
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

  const orphans = dayRows
    .filter(isOrphanCandidate)
    .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());

  if (orphans.length < 2) return 0;

  let voided = 0;
  let open: DayPunch | null = null;

  for (const row of orphans) {
    if (open === null) {
      open = row;
      continue;
    }

    const gapMs = row.clockIn.getTime() - open.clockIn.getTime();

    if (gapMs <= DUPLICATE_PUNCH_WINDOW_MS) {
      await db
        .update(punches)
        .set({
          voidedAt: new Date(),
          notes: `${row.notes ?? ""} · auto:void_dup_orphan`.trim(),
        })
        .where(eq(punches.id, row.id));
      voided++;
      continue;
    }

    if (gapMs > MAX_PAIR_SPAN_MS) {
      open = row;
      continue;
    }

    await db
      .update(punches)
      .set({
        clockOut: row.clockIn,
        notes: cleanedNotes(open.notes),
      })
      .where(eq(punches.id, open.id));

    await db
      .update(punches)
      .set({
        voidedAt: new Date(),
        notes: `${row.notes ?? ""} · auto:merged_into_pair`.trim(),
      })
      .where(eq(punches.id, row.id));

    voided++;
    open = null;
  }

  return voided;
}
