// Audit log read queries. Writes go through lib/db/audit.ts (writeAudit).

import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, type AuditLogRow } from "@/lib/db/schema";

export type ListAuditOpts = {
  /** Cursor: only return rows with id < this. */
  before?: number;
  limit?: number;
  actorId?: string;
  targetType?: string;
};

export async function listAudit(
  opts: ListAuditOpts = {},
): Promise<AuditLogRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const conds: SQL<unknown>[] = [];
  if (opts.before !== undefined) conds.push(lt(auditLog.id, opts.before));
  if (opts.actorId) conds.push(eq(auditLog.actorId, opts.actorId));
  if (opts.targetType) conds.push(eq(auditLog.targetType, opts.targetType));
  const q = db.select().from(auditLog);
  const filtered =
    conds.length > 0 ? q.where(and(...conds)) : q;
  return filtered.orderBy(desc(auditLog.id)).limit(limit);
}
