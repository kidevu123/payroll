// Push subscription queries — read-side helpers. Registration/unregistration
// lives in the employee-facing push actions.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

/** Devices currently enrolled for Web Push — the real "push reach". */
export async function countPushDevices(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pushSubscriptions);
  return row?.n ?? 0;
}
