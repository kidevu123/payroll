// Time-off request queries. Used by missed-punch detection (approved
// requests suppress NO_PUNCH alerts) and by Phase 5's request flow.

import { and, eq, gte, lte, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  timeOffRequests,
  type TimeOffRequest,
} from "@/lib/db/schema";

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
