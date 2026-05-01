// User-shaped queries. All other code goes through this module — never call
// the users table directly from feature code.

import { eq, sql } from "drizzle-orm";
import { hash as argonHash } from "@node-rs/argon2";
import { db } from "@/lib/db";
import { users, type User, type NewUser } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

const ARGON = {
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
} as const;

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "EMPLOYEE";
};

async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON);
}

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

export async function findUserByEmployeeId(
  employeeId: string,
): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.employeeId, employeeId));
  return row ?? null;
}

/** Crockford-style 12-char alphanumeric. Safe to read aloud (no I/L/O/0). */
function generateTempPasswordPlain(): string {
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/**
 * Set a user's password. Sets must_change_password unconditionally (admin-set
 * passwords always require the user to rotate on next login). The plaintext
 * is never logged or returned to the audit row — only "password.set".
 */
export async function setPasswordForUser(
  userId: string,
  plaintext: string,
  actor: Actor,
): Promise<void> {
  if (plaintext.length < 8) throw new Error("Password must be at least 8 characters.");
  const hash = await hashPassword(plaintext);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId));
    if (!before) throw new Error("setPasswordForUser: user not found");
    await tx
      .update(users)
      .set({
        passwordHash: hash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "user.password_set",
        targetType: "User",
        targetId: userId,
      },
      tx,
    );
  });
}

/**
 * Allow a user to clear their own must_change_password flag by submitting a
 * new password. Distinct from setPasswordForUser (admin-driven) so the audit
 * trail stays informative.
 */
export async function changeOwnPassword(
  userId: string,
  newPlaintext: string,
): Promise<void> {
  if (newPlaintext.length < 8) throw new Error("Password must be at least 8 characters.");
  const hash = await hashPassword(newPlaintext);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId));
    if (!before) throw new Error("changeOwnPassword: user not found");
    await tx
      .update(users)
      .set({
        passwordHash: hash,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    await writeAudit(
      {
        actorId: userId,
        actorRole: before.role,
        action: "user.password_change_self",
        targetType: "User",
        targetId: userId,
      },
      tx,
    );
  });
}

/** Admin issues a 12-char temp password. Returned to the caller exactly once. */
export async function generateTempPasswordForUser(
  userId: string,
  actor: Actor,
): Promise<string> {
  const plain = generateTempPasswordPlain();
  await setPasswordForUser(userId, plain, actor);
  return plain;
}

export async function setUserDisabled(
  userId: string,
  disabled: boolean,
  actor: Actor,
): Promise<void> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId));
    if (!before) throw new Error("setUserDisabled: user not found");
    await tx
      .update(users)
      .set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: disabled ? "user.disable" : "user.enable",
        targetType: "User",
        targetId: userId,
      },
      tx,
    );
  });
}

export async function setUserRole(
  userId: string,
  role: "OWNER" | "ADMIN" | "EMPLOYEE",
  actor: Actor,
): Promise<void> {
  if (role === "OWNER" && actor.role !== "OWNER") {
    throw new Error("Only an existing OWNER can grant OWNER.");
  }
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId));
    if (!before) throw new Error("setUserRole: user not found");
    if (before.role === "OWNER" && actor.role !== "OWNER") {
      throw new Error("Cannot demote an OWNER.");
    }
    await tx
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "user.role_change",
        targetType: "User",
        targetId: userId,
        before: { role: before.role },
        after: { role },
      },
      tx,
    );
  });
}

/**
 * Create or attach a User row for an Employee. Returns the temp password
 * generated for them so the admin UI can display it once.
 *
 * Idempotent: if a User already exists for the employee_id, the password
 * is reset and must_change_password is set true. Email collisions return
 * an error to the caller.
 */
export async function inviteEmployeeUser(
  input: {
    employeeId: string;
    email: string;
    role: "ADMIN" | "EMPLOYEE";
  },
  actor: Actor,
): Promise<{ user: User; tempPassword: string }> {
  const tempPlain = generateTempPasswordPlain();
  const hash = await hashPassword(tempPlain);
  const existingByEmployee = await findUserByEmployeeId(input.employeeId);
  if (existingByEmployee) {
    await db
      .update(users)
      .set({
        passwordHash: hash,
        mustChangePassword: true,
        disabledAt: null,
        role: input.role,
        email: input.email,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existingByEmployee.id));
    await writeAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action: "user.invite_resend",
      targetType: "User",
      targetId: existingByEmployee.id,
    });
    const refreshed = await findUserById(existingByEmployee.id);
    if (!refreshed) throw new Error("inviteEmployeeUser: refresh failed");
    return { user: refreshed, tempPassword: tempPlain };
  }
  const collision = await findUserByEmail(input.email);
  if (collision) {
    throw new Error("A user with that email already exists.");
  }
  const [row] = await db
    .insert(users)
    .values({
      email: input.email,
      passwordHash: hash,
      role: input.role,
      employeeId: input.employeeId,
      mustChangePassword: true,
    })
    .returning();
  if (!row) throw new Error("inviteEmployeeUser: insert returned no row");
  await writeAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: "user.invite",
    targetType: "User",
    targetId: row.id,
    after: { email: row.email, role: row.role, employeeId: row.employeeId },
  });
  return { user: row, tempPassword: tempPlain };
}
