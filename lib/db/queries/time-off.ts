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
