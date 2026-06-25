import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { Actor } from "./employees";

/**
 * The OWNER user, acting as the system actor for automated mutations —
 * poll-driven punch housekeeping (auto-merge, chained-segment merge) and the
 * break-glass repair scripts. Every change these make is still individually
 * audited via writeAudit. Previously four files held identical private copies.
 */
export async function getSystemOwnerActor(): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.role, "OWNER"))
    .limit(1);
  if (!row) throw new Error("getSystemOwnerActor: no OWNER user");
  return { id: row.id, role: "OWNER" };
}
