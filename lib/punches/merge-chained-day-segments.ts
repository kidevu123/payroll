// NGTeco fingerprint noise often creates back-to-back micro-shifts on one day
// (e.g. 6:00–6:05, 6:05–6:04p, 6:04–6:17p). When segments chain with no real
// break between them, collapse to one row: IN from the longest segment, OUT latest.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { punches } from "@/lib/db/schema";
import { editPunch, voidPunch } from "@/lib/db/queries/punches";
import { getSystemOwnerActor } from "@/lib/db/queries/system-actor";
import { localDayBoundsForPollImport } from "./poll-importer";
import { DUPLICATE_PUNCH_WINDOW_MS } from "./pair-events";
import { rankShiftsBySurvivor } from "./near-duplicate-shift";

type DayRow = {
  id: string;
  clockIn: Date;
  clockOut: Date | null;
};

export function findChainedSegmentGroups<T extends DayRow>(
  rows: T[],
  maxGapMs: number = DUPLICATE_PUNCH_WINDOW_MS,
): T[][] {
  const closed = rows
    .filter((r): r is T & { clockOut: Date } => r.clockOut !== null)
    .sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
  if (closed.length < 2) return [];

  const chains: T[][] = [];
  let current: T[] = [closed[0]!];

  for (let i = 1; i < closed.length; i++) {
    const prev = current[current.length - 1]!;
    const next = closed[i]!;
    const prevOut = prev.clockOut;
    if (!prevOut) {
      if (current.length > 1) chains.push(current);
      current = [next];
      continue;
    }
    const gapMs = next.clockIn.getTime() - prevOut.getTime();
    if (gapMs <= maxGapMs) {
      current.push(next);
    } else {
      if (current.length > 1) chains.push(current);
      current = [next];
    }
  }
  if (current.length > 1) chains.push(current);
  return chains;
}

export function mergedChainedShiftBounds(chain: DayRow[]): {
  clockIn: Date;
  clockOut: Date;
} {
  const survivor = rankShiftsBySurvivor(chain)[0]!;
  const clockOut = chain.reduce(
    (latest, row) => {
      const out = row.clockOut!;
      return out.getTime() > latest.getTime() ? out : latest;
    },
    chain[0]!.clockOut!,
  );
  return { clockIn: survivor.clockIn, clockOut };
}

/**
 * Collapse chained micro-segments for one employee-day. Idempotent.
 * Returns number of punch rows voided after merging.
 */
export async function mergeChainedDaySegments(
  employeeId: string,
  dayIso: string,
  timezone: string,
): Promise<number> {
  const { dayStart, dayEnd } = localDayBoundsForPollImport(dayIso, timezone);
  const rows = await db
    .select({
      id: punches.id,
      clockIn: punches.clockIn,
      clockOut: punches.clockOut,
    })
    .from(punches)
    .where(
      and(
        eq(punches.employeeId, employeeId),
        sql`${punches.clockIn} >= ${dayStart.toISOString()}::timestamptz`,
        sql`${punches.clockIn} < ${dayEnd.toISOString()}::timestamptz`,
        sql`${punches.voidedAt} IS NULL`,
      ),
    );

  const chains = findChainedSegmentGroups(rows);
  if (chains.length === 0) return 0;

  const actor = await getSystemOwnerActor();
  let voided = 0;

  for (const chain of chains) {
    const { clockIn, clockOut } = mergedChainedShiftBounds(chain);
    const survivor = rankShiftsBySurvivor(chain)[0]!;
    const needsEdit =
      survivor.clockIn.getTime() !== clockIn.getTime() ||
      survivor.clockOut?.getTime() !== clockOut.getTime();

    if (needsEdit) {
      await editPunch(
        survivor.id,
        { clockIn, clockOut },
        `auto-merge chained segments on ${dayIso}`,
        actor,
      );
    }

    for (const row of chain) {
      if (row.id === survivor.id) continue;
      await voidPunch(
        row.id,
        `dedup: chained micro-segment merged into ${survivor.id} on ${dayIso}`,
        actor,
      );
      voided++;
    }
  }

  return voided;
}
