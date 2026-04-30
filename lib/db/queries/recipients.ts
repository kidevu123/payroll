// Resolve notification recipients: admin set, and employee-by-employeeId.

import { eq, inArray, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function adminUserIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.role, ["OWNER", "ADMIN"]),
        isNull(users.disabledAt),
      ),
    );
  return rows.map((r) => r.id);
}

export async function userIdForEmployee(employeeId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.employeeId, employeeId));
  return row?.id ?? null;
}

export async function userIdsForEmployees(employeeIds: string[]): Promise<Map<string, string>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, employeeId: users.employeeId })
    .from(users)
    .where(inArray(users.employeeId, employeeIds));
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.employeeId) map.set(r.employeeId, r.id);
  }
  return map;
}
