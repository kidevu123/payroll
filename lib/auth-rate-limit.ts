// Postgres-backed login rate limit. No Redis dependency.

import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
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
  // A successful login RESETS the counter: only failures since the most recent
  // success count toward lockout. Without this, a user who fails a few times,
  // then logs in correctly, could still be locked out on their very next try.
  const [lastSuccess] = await db
    .select({ at: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(
      and(eq(loginAttempts.email, email), eq(loginAttempts.succeeded, true)),
    )
    .orderBy(desc(loginAttempts.attemptedAt))
    .limit(1);
  const floor = lastSuccess && lastSuccess.at > cutoff ? lastSuccess.at : cutoff;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.email, email),
        eq(loginAttempts.succeeded, false),
        lastSuccess
          ? gt(loginAttempts.attemptedAt, floor)
          : gte(loginAttempts.attemptedAt, floor),
      ),
    );
  return (row?.count ?? 0) >= maxAttempts;
}
