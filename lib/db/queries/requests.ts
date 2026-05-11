// Missed-punch + time-off request queries. Phase 5.
//
// approveMissedPunchRequest is the moneyball: it creates the resulting
// Punch, links the alert + request, all in one transaction with audit.

import { and, desc, eq, gte, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  missedPunchAlerts,
  missedPunchRequests,
  employees,
  payPeriods,
  punches,
  timeOffRequests,
  type MissedPunchRequest,
  type NewMissedPunchRequest,
  type NewTimeOffRequest,
  type TimeOffRequest,
} from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE";
};

// ── Missed-punch requests ───────────────────────────────────────────────────

export async function listPendingMissedPunchRequests(): Promise<MissedPunchRequest[]> {
  return db
    .select()
    .from(missedPunchRequests)
    .where(eq(missedPunchRequests.status, "PENDING"))
    .orderBy(desc(missedPunchRequests.createdAt));
}

export async function listMissedPunchRequestsForEmployee(
  employeeId: string,
): Promise<MissedPunchRequest[]> {
  return db
    .select()
    .from(missedPunchRequests)
    .where(eq(missedPunchRequests.employeeId, employeeId))
    .orderBy(desc(missedPunchRequests.createdAt));
}

export async function getMissedPunchRequest(id: string): Promise<MissedPunchRequest | null> {
  const [row] = await db
    .select()
    .from(missedPunchRequests)
    .where(eq(missedPunchRequests.id, id));
  return row ?? null;
}

export async function createMissedPunchRequest(
  input: NewMissedPunchRequest,
  actor: Actor,
): Promise<MissedPunchRequest> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(missedPunchRequests)
      .values(input)
      .returning();
    if (!row) throw new Error("createMissedPunchRequest: insert returned no row");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "missed_punch.request.create",
        targetType: "MissedPunchRequest",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

/**
 * Approve a missed-punch request. Creates a Punch with
 * source=MISSED_PUNCH_APPROVED using the claimed in/out, links the
 * resulting punch to the request, resolves the linked alert (if any),
 * and audits — all in one transaction.
 */
export async function approveMissedPunchRequest(
  requestId: string,
  resolutionNote: string | null,
  actor: Actor,
): Promise<MissedPunchRequest> {
  const { getSetting } = await import("@/lib/settings/runtime");
  const company = await getSetting("company").catch(() => ({
    timezone: "America/New_York",
  }));
  const dayFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: company.timezone,
  });

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(missedPunchRequests)
      .where(eq(missedPunchRequests.id, requestId));
    if (!before) throw new Error(`approveMissedPunchRequest: ${requestId} not found`);
    if (before.status !== "PENDING") return before;
    if (!before.claimedClockIn) {
      throw new Error("approveMissedPunchRequest: request has no claimed clockIn");
    }
    const claimedDay = dayFmt.format(before.claimedClockIn);
    const [employee] = await tx
      .select({ payScheduleId: employees.payScheduleId })
      .from(employees)
      .where(eq(employees.id, before.employeeId));
    const [requestPeriod] = await tx
      .select({
        startDate: payPeriods.startDate,
        endDate: payPeriods.endDate,
      })
      .from(payPeriods)
      .where(eq(payPeriods.id, before.periodId));
    let periodId = before.periodId;
    if (employee?.payScheduleId) {
      const [matchingPeriod] = await tx
        .select({ id: payPeriods.id })
        .from(payPeriods)
        .where(
          and(
            eq(payPeriods.payScheduleId, employee.payScheduleId),
            lte(payPeriods.startDate, claimedDay),
            gte(payPeriods.endDate, claimedDay),
          ),
        )
        .limit(1);
      periodId = matchingPeriod?.id ?? periodId;
    } else if (
      !requestPeriod ||
      claimedDay < requestPeriod.startDate ||
      claimedDay > requestPeriod.endDate
    ) {
      const [matchingPeriod] = await tx
        .select({ id: payPeriods.id })
        .from(payPeriods)
        .where(
          and(
            lte(payPeriods.startDate, claimedDay),
            gte(payPeriods.endDate, claimedDay),
          ),
        )
        .limit(1);
      periodId = matchingPeriod?.id ?? periodId;
    }
    // Create the resulting punch.
    const [punch] = await tx
      .insert(punches)
      .values({
        employeeId: before.employeeId,
        periodId,
        clockIn: before.claimedClockIn,
        clockOut: before.claimedClockOut ?? null,
        source: "MISSED_PUNCH_APPROVED",
        notes: `From request ${before.id}`,
      })
      .returning();
    if (!punch) throw new Error("approveMissedPunchRequest: punch insert empty");

    const [row] = await tx
      .update(missedPunchRequests)
      .set({
        periodId,
        status: "APPROVED",
        resolvedById: actor.id,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote ?? null,
        resultingPunchId: punch.id,
      })
      .where(eq(missedPunchRequests.id, requestId))
      .returning();
    if (!row) throw new Error("approveMissedPunchRequest: update empty");

    if (before.alertId) {
      await tx
        .update(missedPunchAlerts)
        .set({ resolvedAt: new Date(), linkedRequestId: row.id })
        .where(eq(missedPunchAlerts.id, before.alertId));
    }

    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "missed_punch.request.approve",
        targetType: "MissedPunchRequest",
        targetId: requestId,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function rejectMissedPunchRequest(
  requestId: string,
  resolutionNote: string,
  actor: Actor,
): Promise<MissedPunchRequest> {
  if (!resolutionNote.trim()) {
    throw new Error("rejectMissedPunchRequest: resolutionNote required");
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(missedPunchRequests)
      .where(eq(missedPunchRequests.id, requestId));
    if (!before) throw new Error(`rejectMissedPunchRequest: ${requestId} not found`);
    if (before.status !== "PENDING") return before;
    const [row] = await tx
      .update(missedPunchRequests)
      .set({
        status: "REJECTED",
        resolvedById: actor.id,
        resolvedAt: new Date(),
        resolutionNote,
      })
      .where(eq(missedPunchRequests.id, requestId))
      .returning();
    if (!row) throw new Error("rejectMissedPunchRequest: update empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "missed_punch.request.reject",
        targetType: "MissedPunchRequest",
        targetId: requestId,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

// ── Time-off requests ───────────────────────────────────────────────────────

export async function listPendingTimeOffRequests(): Promise<TimeOffRequest[]> {
  return db
    .select()
    .from(timeOffRequests)
    .where(eq(timeOffRequests.status, "PENDING"))
    .orderBy(desc(timeOffRequests.createdAt));
}

export async function listTimeOffRequestsForEmployee(
  employeeId: string,
): Promise<TimeOffRequest[]> {
  return db
    .select()
    .from(timeOffRequests)
    .where(eq(timeOffRequests.employeeId, employeeId))
    .orderBy(desc(timeOffRequests.createdAt));
}

/**
 * Approved time-off whose date range overlaps [from, to]. Used by the
 * employee Calendar tab so colleagues can see who's off this week.
 */
export async function listApprovedTimeOffOverlapping(args: {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}): Promise<TimeOffRequest[]> {
  return db
    .select()
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.status, "APPROVED"),
        sql`${timeOffRequests.startDate} <= ${args.to}`,
        sql`${timeOffRequests.endDate} >= ${args.from}`,
      ),
    )
    .orderBy(timeOffRequests.startDate);
}

export async function createTimeOffRequest(
  input: NewTimeOffRequest,
  actor: Actor,
): Promise<TimeOffRequest> {
  return db.transaction(async (tx) => {
    // SCHEDULE_NOTE is heads-up only — no approval needed, no payroll
    // impact, doesn't reserve the day. Skip the overlap check (an
    // hourly employee saying "leaving at 2pm" doesn't conflict with
    // anything) and stamp APPROVED at insert so it lands on the
    // calendar immediately. Other types still flow through
    // PENDING → admin → APPROVED/REJECTED.
    const isHeadsUp = input.type === "SCHEDULE_NOTE";

    if (!isHeadsUp) {
      // Reject overlap with any pending or approved request for the
      // same employee. Rejected/cancelled rows are ignored. Range
      // overlap test: existing.start <= new.end AND existing.end >= new.start.
      const overlap = await tx
        .select({ id: timeOffRequests.id })
        .from(timeOffRequests)
        .where(
          and(
            eq(timeOffRequests.employeeId, input.employeeId),
            or(
              eq(timeOffRequests.status, "PENDING"),
              eq(timeOffRequests.status, "APPROVED"),
            ),
            // SCHEDULE_NOTE rows don't block real time-off requests —
            // exclude them from the overlap probe.
            sql`${timeOffRequests.type} <> 'SCHEDULE_NOTE'`,
            sql`${timeOffRequests.startDate} <= ${input.endDate}`,
            sql`${timeOffRequests.endDate} >= ${input.startDate}`,
          ),
        )
        .limit(1);
      if (overlap.length > 0) {
        throw new Error("TIME_OFF_OVERLAP");
      }
    }

    const insertRow: NewTimeOffRequest = isHeadsUp
      ? {
          ...input,
          status: "APPROVED",
          resolvedById: actor.id,
          resolvedAt: new Date(),
          resolutionNote: "Auto-acknowledged (heads-up)",
        }
      : input;

    const [row] = await tx.insert(timeOffRequests).values(insertRow).returning();
    if (!row) throw new Error("createTimeOffRequest: insert empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: isHeadsUp
          ? "time_off.schedule_note.create"
          : "time_off.request.create",
        targetType: "TimeOffRequest",
        targetId: row.id,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function resolveTimeOffRequest(
  requestId: string,
  status: "APPROVED" | "REJECTED",
  resolutionNote: string | null,
  actor: Actor,
): Promise<TimeOffRequest> {
  if (status === "REJECTED" && !resolutionNote?.trim()) {
    throw new Error("resolveTimeOffRequest: rejection needs a note");
  }
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(timeOffRequests)
      .where(eq(timeOffRequests.id, requestId));
    if (!before) throw new Error(`resolveTimeOffRequest: ${requestId} not found`);
    if (before.status !== "PENDING") return before;
    const [row] = await tx
      .update(timeOffRequests)
      .set({
        status,
        resolvedById: actor.id,
        resolvedAt: new Date(),
        resolutionNote: resolutionNote ?? null,
      })
      .where(eq(timeOffRequests.id, requestId))
      .returning();
    if (!row) throw new Error("resolveTimeOffRequest: update empty");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: `time_off.request.${status.toLowerCase()}`,
        targetType: "TimeOffRequest",
        targetId: requestId,
        before,
        after: row,
      },
      tx,
    );
    return row;
  });
}

export async function getMissedPunchAlertById(
  id: string,
): Promise<typeof missedPunchAlerts.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(missedPunchAlerts)
    .where(and(eq(missedPunchAlerts.id, id), isNull(missedPunchAlerts.resolvedAt)));
  return row ?? null;
}
