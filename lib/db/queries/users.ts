// User-shaped queries. All other code goes through this module — never call
// the users table directly from feature code.

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User, type NewUser } from "@/lib/db/schema";

export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .limit(1);
  return (row?.count ?? 0) > 0;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email));
  return row ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function createUser(input: NewUser): Promise<User> {
  const [row] = await db.insert(users).values(input).returning();
  if (!row) throw new Error("createUser: insert returned no row");
  return row;
}

export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await db
    .update(users)
    .set({
      lastLoginAt: new Date(),
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId));
}

export async function recordFailedLogin(email: string): Promise<void> {
  // Soft increment — if user doesn't exist, the loginAttempts table catches it.
  await db
    .update(users)
    .set({
      failedLoginCount: sql`${users.failedLoginCount} + 1`,
    })
    .where(eq(users.email, email));
}
