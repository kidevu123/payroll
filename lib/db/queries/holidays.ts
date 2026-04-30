// Holiday lookups. Used by missed-punch detection.

import { and, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { holidays, type Holiday } from "@/lib/db/schema";

export async function listHolidaysInRange(
  startDate: string,
  endDate: string,
): Promise<Holiday[]> {
  return db
    .select()
    .from(holidays)
    .where(and(gte(holidays.date, startDate), lte(holidays.date, endDate)));
}
