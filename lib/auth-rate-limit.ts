// Postgres-backed login rate limit. No Redis dependency.

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";
import { getSetting } from "@/lib/settings/runtime";

export async function recordLoginAttempt(input: {
  email: string;
  ip: string;
  succeeded: boolean;
}): Promise<void> {
  await db.insert(loginAttempts).values(input);
}

export async function isRateLimited(email: string): Promise<boolean> {
  const security = await getSetting("security");
  const { maxAttempts, windowMinutes } = security.loginRateLimit;
  const cutoff = new Date(Date.now() - windowMinutes * 60_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email),
        eq(loginAttempts.succeeded, false),
        gte(loginAttempts.attemptedAt, cutoff),
      ),
    );
  return (row?.count ?? 0) >= maxAttempts;
}
