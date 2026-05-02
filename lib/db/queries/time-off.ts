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
