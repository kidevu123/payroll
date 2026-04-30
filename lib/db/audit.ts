// Audit log writer. Every mutation in the system goes through this before
// commit (§3 invariant).

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { headers } from "next/headers";

export type AuditEntry = {
  actorId: string | null;
  actorRole: "OWNER" | "ADMIN" | "EMPLOYEE" | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
};

export async function writeAudit(entry: AuditEntry): Promise<void> {
  let ip: string | null = null;
  let userAgent: string | null = null;
  try {
    const h = await headers();
    ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      null;
    userAgent = h.get("user-agent");
  } catch {
    // Outside a request context (jobs, scripts) — leave IP/UA null.
  }
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    actorRole: entry.actorRole,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip,
    userAgent,
  });
}
