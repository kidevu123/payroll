// Time-off request queries. Used by missed-punch detection (approved
// requests suppress NO_PUNCH alerts) and by Phase 5's request flow.

import { and, desc, eq, gte, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  timeOffRequests,
  type TimeOffRequest,
} from "@/lib/db/schema";

/** Most recent time-off requests for an employee — covers their portal
 *  history view ("here's what you've requested + the status"). */
export async function listRecentForEmployee(
  employeeId: string,
  limit = 20,
): Promise<TimeOffRequest[]> {
  return db
    .select()
    .from(timeOffRequests)
    .where(eq(timeOffRequests.employeeId, employeeId))
    .orderBy(desc(timeOffRequests.createdAt))
    .limit(limit);
}

/** Approved time-off intersecting [startDate, endDate]. Used by the admin
 *  calendar — feeds the colored bars stretched across the affected days. */
export async function listApprovedInRange(
  startDate: string,
  endDate: string,
): Promise<TimeOffRequest[]> {
  return db
    .select()
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.status, "APPROVED"),
        or(
          and(
            gte(timeOffRequests.startDate, startDate),
            lte(timeOffRequests.startDate, endDate),
          ),
          and(
            gte(timeOffRequests.endDate, startDate),
            lte(timeOffRequests.endDate, endDate),
          ),
          and(
            lte(timeOffRequests.startDate, startDate),
            gte(timeOffRequests.endDate, endDate),
          ),
        ),
      ),
    );
}

/** Pending requests intersecting a range — shown faded on the calendar so
 *  admin can see what's coming up without it counting as "approved off". */
export async function listPendingInRange(
  startDate: string,
  endDate: string,
): Promise<TimeOffRequest[]> {
  return db
    .select()
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.status, "PENDING"),
        or(
          and(
            gte(timeOffRequests.startDate, startDate),
            lte(timeOffRequests.startDate, endDate),
          ),
          and(
            gte(timeOffRequests.endDate, startDate),
            lte(timeOffRequests.endDate, endDate),
          ),
          and(
            lte(timeOffRequests.startDate, startDate),
            gte(timeOffRequests.endDate, endDate),
          ),
        ),
      ),
    );
}

/** Cancel a time-off request. Used by:
 *  - the employee from /me/home when they catch a mistake (only their
 *    own PENDING requests; APPROVED ones need the admin),
 *  - the admin from /requests when an approval needs walking back.
 *  Sets status = CANCELLED + audit fields. Idempotent: re-canceling
 *  a CANCELLED request is a no-op. */
export async function cancelTimeOffRequest(
  requestId: string,
  resolverUserId: string,
  resolutionNote: string | null,
): Promise<TimeOffRequest | null> {
  const [out] = await db
    .update(timeOffRequests)
    .set({
      status: "CANCELLED",
      resolvedById: resolverUserId,
      resolvedAt: new Date(),
      resolutionNote,
    })
    .where(eq(timeOffRequests.id, requestId))
    .returning();
  return out ?? null;
}

/** Look up a request by id. Used to verify ownership / status before
 *  letting an employee cancel. */
export async function getTimeOffRequest(
  requestId: string,
): Promise<TimeOffRequest | null> {
  const [row] = await db
    .select()
    .from(timeOffRequests)
    .where(eq(timeOffRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

/** Aggregated time-off totals per employee for a calendar year.
 *  Used by /reports/time-off — answers "did anyone take too much time
 *  off this year?". Counts:
 *    - Full-day rows: number of calendar days in [start, end] (inclusive).
 *      Both ends in the requested year only — ranges that span year
 *      boundaries are clipped.
 *    - Partial-day rows: hours derived from partialEndTime − partialStartTime.
 *      A partial row with only one of the two times is treated as a full
 *      shift's-worth of partial (8h) — this is rare; the form normally
 *      requires both for SCHEDULE_NOTE.
 *  SCHEDULE_NOTE rows are tallied separately so admin can distinguish
 *  "heads-up" hours from actual time-off.
 *
 *  Only APPROVED rows count. PENDING / REJECTED / CANCELLED are ignored.
 */
export async function tallyTimeOffByEmployeeForYear(
  year: number,
): Promise<
  Array<{
    employeeId: string;
    unpaidDays: number;
    sickDays: number;
    personalDays: number;
    otherDays: number;
    scheduleNoteHours: number;
  }>
> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const rows = await db
    .select()
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.status, "APPROVED"),
        // Any range that overlaps the year — clipped below.
        and(
          gte(timeOffRequests.endDate, yearStart),
          lte(timeOffRequests.startDate, yearEnd),
        ),
      ),
    );

  const totals = new Map<
    string,
    {
      unpaidDays: number;
      sickDays: number;
      personalDays: number;
      otherDays: number;
      scheduleNoteHours: number;
    }
  >();
  const get = (empId: string) => {
    let t = totals.get(empId);
    if (!t) {
      t = {
        unpaidDays: 0,
        sickDays: 0,
        personalDays: 0,
        otherDays: 0,
        scheduleNoteHours: 0,
      };
      totals.set(empId, t);
    }
    return t;
  };

  for (const r of rows) {
    const t = get(r.employeeId);
    // Clip the range to the requested year.
    const start = r.startDate < yearStart ? yearStart : r.startDate;
    const end = r.endDate > yearEnd ? yearEnd : r.endDate;
    // Inclusive day count: end − start + 1.
    const startMs = new Date(`${start}T00:00:00Z`).getTime();
    const endMs = new Date(`${end}T00:00:00Z`).getTime();
    const days = Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);

    if (r.type === "SCHEDULE_NOTE") {
      // Hours derived from partial window. If only one bound was given,
      // approximate as 8h (the spec considers SCHEDULE_NOTE rows
      // optional-detail; precision isn't load-bearing for an annual
      // tally).
      let hours = 8;
      if (r.partialStartTime && r.partialEndTime) {
        const s = parseTime(r.partialStartTime);
        const e = parseTime(r.partialEndTime);
        if (s !== null && e !== null && e > s) hours = (e - s) / 60;
      }
      t.scheduleNoteHours += hours;
    } else if (r.type === "UNPAID") {
      t.unpaidDays += days;
    } else if (r.type === "SICK") {
      t.sickDays += days;
    } else if (r.type === "PERSONAL") {
      t.personalDays += days;
    } else if (r.type === "OTHER") {
      t.otherDays += days;
    }
  }

  return Array.from(totals.entries()).map(([employeeId, v]) => ({
    employeeId,
    ...v,
  }));
}

/** Parse "HH:MM" or "HH:MM:SS" to minutes-since-midnight. Returns null
 *  on malformed input. */
function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

export async function listApprovedTimeOffInRange(
  startDate: string,
  endDate: string,
): Promise<TimeOffRequest[]> {
  // Any range that overlaps [startDate, endDate].
  return db
    .select()
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.status, "APPROVED"),
        or(
          and(
            gte(timeOffRequests.startDate, startDate),
            lte(timeOffRequests.startDate, endDate),
          ),
          and(
            gte(timeOffRequests.endDate, startDate),
            lte(timeOffRequests.endDate, endDate),
          ),
          and(
            lte(timeOffRequests.startDate, startDate),
            gte(timeOffRequests.endDate, endDate),
          ),
        ),
      ),
    );
}
