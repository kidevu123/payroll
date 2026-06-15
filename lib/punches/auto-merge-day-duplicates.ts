// Void duplicate punch rows for one employee on one company-local calendar day.
// Runs after every NGTeco poll import so duplicates never sit on the Time grid.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { punches, users } from "@/lib/db/schema";
import { voidPunch } from "@/lib/db/queries/punches";
import { localDayBoundsForPollImport } from "./poll-importer";
import {
  minuteClusterKey,
  rankShiftsBySurvivor,
  shiftsAreNearDuplicates,
} from "./near-duplicate-shift";

async function systemActor() {
  const [row] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.role, "OWNER"))
    .limit(1);
  if (!row) throw new Error("auto-merge-day-duplicates: no OWNER user");
  return { id: row.id, role: row.role as "OWNER" };
}

type DayRow = {
  id: string;
  employeeId: string;
  clockIn: Date;
  clockOut: Date | null;
};

function clusterRows(rows: DayRow[]): DayRow[][] {
  const byMinute = new Map<string, DayRow[]>();
  for (const r of rows) {
    const key = minuteClusterKey(r);
    const list = byMinute.get(key) ?? [];
    list.push(r);
    byMinute.set(key, list);
  }

  const clusters: DayRow[][] = [];
  for (const list of byMinute.values()) {
    if (list.length > 1) {
      clusters.push(list);
      continue;
    }
    const lone = list[0]!;
    if (!lone.clockOut) continue;
    const near = rows.filter(
      (other) =>
        other.id !== lone.id &&
        other.clockOut &&
        shiftsAreNearDuplicates(lone, other),
    );
    if (near.length > 0) clusters.push([lone, ...near]);
  }
  return clusters;
}

/**
 * Merge duplicate shifts for (employeeId, dayIso). Idempotent.
 * Returns count of voided punch rows.
 */
export async function autoMergeDuplicatePunchesForDay(
  employeeId: string,
  dayIso: string,
  timezone: string,
): Promise<number> {
  const { dayStart, dayEnd } = localDayBoundsForPollImport(dayIso, timezone);
  const rows = await db
    .select({
      id: punches.id,
      employeeId: punches.employeeId,
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

  const clusters = clusterRows(rows);
  if (clusters.length === 0) return 0;

  const actor = await systemActor();
  let voided = 0;
  const voidedIds = new Set<string>();

  for (const cluster of clusters) {
    const active = cluster.filter((r) => !voidedIds.has(r.id));
    if (active.length <= 1) continue;
    const ranked = rankShiftsBySurvivor(active);
    const survivor = ranked[0]!;
    for (const row of ranked.slice(1)) {
      await voidPunch(
        row.id,
        `dedup: auto-merge ${dayIso} (kept ${survivor.id})`,
        actor,
      );
      voidedIds.add(row.id);
      voided++;
    }
  }
  return voided;
}
