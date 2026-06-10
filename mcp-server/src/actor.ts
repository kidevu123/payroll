import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { Actor } from "@/lib/db/queries/employees";
import { findUserByEmail, findUserById } from "@/lib/db/queries/users";
import { optionalEnv, requireEnv } from "./env.js";

const ADMIN_ROLES = new Set<Actor["role"]>([
  "OWNER",
  "ADMIN",
  "PAYROLL_STAFF",
]);

export async function resolveMcpActor(): Promise<Actor> {
  const explicitId = optionalEnv("MCP_ACTOR_USER_ID");
  if (explicitId) {
    const user = await findUserById(explicitId);
    if (!user) {
      throw new Error(`MCP_ACTOR_USER_ID not found: ${explicitId}`);
    }
    if (!ADMIN_ROLES.has(user.role)) {
      throw new Error(
        `MCP actor must be OWNER, ADMIN, or PAYROLL_STAFF (got ${user.role}).`,
      );
    }
    return { id: user.id, role: user.role };
  }

  const email =
    optionalEnv("MCP_ACTOR_EMAIL") ?? optionalEnv("OWNER_EMAIL");
  if (!email) {
    throw new Error(
      "Set MCP_ACTOR_EMAIL, MCP_ACTOR_USER_ID, or OWNER_EMAIL for audit attribution.",
    );
  }

  const user = await findUserByEmail(email);
  if (!user) {
    throw new Error(`MCP actor email not found: ${email}`);
  }
  if (!ADMIN_ROLES.has(user.role)) {
    throw new Error(
      `MCP actor must be OWNER, ADMIN, or PAYROLL_STAFF (got ${user.role}).`,
    );
  }
  return { id: user.id, role: user.role };
}

/** Fallback owner lookup when env is misconfigured but DB has exactly one OWNER. */
export async function resolveMcpActorWithFallback(): Promise<Actor> {
  try {
    return await resolveMcpActor();
  } catch {
    const [owner] = await db
      .select()
      .from(users)
      .where(eq(users.role, "OWNER"))
      .limit(1);
    if (!owner) {
      throw new Error(
        "Could not resolve MCP actor. Set MCP_ACTOR_EMAIL or MCP_ACTOR_USER_ID.",
      );
    }
    return { id: owner.id, role: owner.role };
  }
}

export function validateStartupEnv(mode: "stdio" | "http"): void {
  requireEnv("DATABASE_URL");
  requireEnv("MCP_SERVICE_TOKEN");
  if (mode === "http") {
    optionalEnv("MCP_HTTP_PORT") ?? "3100";
  }
}
