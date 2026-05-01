// Audit log read queries. Writes go through lib/db/audit.ts (writeAudit).
//
// Phase 6 polish adds: date range, action keyword search, and the inline
// before/after diff is rendered by the page (the row carries the JSONB
// already, so the query just needs to surface it).

import { and, desc, eq, gte, ilike, lt, lte, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, type AuditLogRow } from "@/lib/db/schema";

export type ListAuditOpts = {
  /** Cursor: only return rows with id < this. */
  before?: number;
  limit?: number;
  actorId?: string;
  targetType?: string;
  /** YYYY-MM-DD inclusive lower bound on createdAt. */
  fromDate?: string;
  /** YYYY-MM-DD inclusive upper bound on createdAt. */
  toDate?: string;
  /** Substring match on `action` (case-insensitive). */
  actionLike?: string;
};

export async function listAudit(
  opts: ListAuditOpts = {},
): Promise<AuditLogRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const conds: SQL<unknown>[] = [];
  if (opts.before !== undefined) conds.push(lt(auditLog.id, opts.before));
  if (opts.actorId) conds.push(eq(auditLog.actorId, opts.actorId));
  if (opts.targetType) conds.push(eq(auditLog.targetType, opts.targetType));
  if (opts.fromDate) {
    conds.push(gte(auditLog.createdAt, new Date(`${opts.fromDate}T00:00:00Z`)));
  }
  if (opts.toDate) {
    conds.push(lte(auditLog.createdAt, new Date(`${opts.toDate}T23:59:59Z`)));
  }
  if (opts.actionLike) {
    conds.push(ilike(auditLog.action, `%${opts.actionLike}%`));
  }
  const q = db.select().from(auditLog);
  const filtered = conds.length > 0 ? q.where(and(...conds)) : q;
  return filtered.orderBy(desc(auditLog.id)).limit(limit);
}
