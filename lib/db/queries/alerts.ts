// Missed-punch alert queries. Detection writes; admin/employee resolve.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  missedPunchAlerts,
  type MissedPunchAlert,
  type NewMissedPunchAlert,
} from "@/lib/db/schema";

export async function listAlertsForPeriod(
  periodId: string,
  opts: { unresolvedOnly?: boolean } = {},
): Promise<MissedPunchAlert[]> {
  const where = opts.unresolvedOnly
    ? and(eq(missedPunchAlerts.periodId, periodId), isNull(missedPunchAlerts.resolvedAt))
    : eq(missedPunchAlerts.periodId, periodId);
  return db.select().from(missedPunchAlerts).where(where);
}

export async function listAlertsForEmployee(
  employeeId: string,
  opts: { unresolvedOnly?: boolean } = {},
): Promise<MissedPunchAlert[]> {
  const where = opts.unresolvedOnly
    ? and(eq(missedPunchAlerts.employeeId, employeeId), isNull(missedPunchAlerts.resolvedAt))
    : eq(missedPunchAlerts.employeeId, employeeId);
  return db.select().from(missedPunchAlerts).where(where);
}

export async function createAlerts(
  rows: NewMissedPunchAlert[],
): Promise<MissedPunchAlert[]> {
  if (rows.length === 0) return [];
  return db.insert(missedPunchAlerts).values(rows).returning();
}

export async function resolveAlert(
  id: string,
  linkedRequestId: string | null = null,
): Promise<void> {
  const set: Partial<MissedPunchAlert> = { resolvedAt: new Date() };
  if (linkedRequestId !== null) set.linkedRequestId = linkedRequestId;
  await db.update(missedPunchAlerts).set(set).where(eq(missedPunchAlerts.id, id));
}
