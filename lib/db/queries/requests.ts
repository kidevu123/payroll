// Missed-punch + time-off request queries. Phase 5.
//
// approveMissedPunchRequest is the moneyball: it creates the resulting
// Punch, links the alert + request, all in one transaction with audit.

import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
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
import {
  isAmbiguousSinglePunch,
  isMissingClockInPunch,
} from "@/lib/punches/missing-punch";
import {
  timeOffChangeApprovalPlan,
  type TimeOffChangeAction,
} from "@/lib/time-off/change-request";
import {
  buildMissedPunchReviewContext,
  type MissedPunchReviewContext,
} from "@/lib/missed-punch/review-context";
import { listPunches } from "@/lib/db/queries/punches";
import { localMidnightUtc } from "@/lib/utils";
import { wallClockToUtc } from "@/lib/time/wall-clock";

export type Actor = {
  id: string;
  role: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT" | "EMPLOYEE";
};

/** Re-anchor a claimed instant onto the request date in company tz (wrong-day typos). */
function anchorClaimToRequestDate(
  instant: Date,
  requestDateIso: string,
  timezone: string,
): Date | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const wall = `${requestDateIso}T${get("hour")}:${get("minute")}:${get("second")}`;
  return wallClockToUtc(wall, timezone);
}

// ── Missed-punch requests ───────────────────────────────────────────────────

export async function listPendingMissedPunchRequests(): Promise<MissedPunchRequest[]> {
  return db
    .select()
    .from(missedPunchRequests)
    .where(eq(missedPunchRequests.status, "PENDING"))
    .orderBy(desc(missedPunchRequests.createdAt));
}

export type PendingMissedPunchReview = {
  request: MissedPunchRequest;
  review: MissedPunchReviewContext;
};

/** Pending missed-punch requests with on-file punch context for admin review UI. */
export async function listPendingMissedPunchRequestsForReview(
  timezone: string,
): Promise<PendingMissedPunchReview[]> {
  const requests = await listPendingMissedPunchRequests();
  if (requests.length === 0) return [];

  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  const dayKey = (d: Date) => dayFmt.format(d);

  const alertIds = [
    ...new Set(
      requests.map((r) => r.alertId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const alerts =
    alertIds.length > 0
      ? await db
          .select({
            id: missedPunchAlerts.id,
            issue: missedPunchAlerts.issue,
          })
          .from(missedPunchAlerts)
          .where(inArray(missedPunchAlerts.id, alertIds))
      : [];
  const issueByAlert = new Map(alerts.map((a) => [a.id, a.issue]));

  const groupKeys = new Map<
    string,
    {
      employeeId: string;
      periodId: string;
      date: string;
      items: MissedPunchRequest[];
    }
  >();
  for (const r of requests) {
    const key = `${r.employeeId}:${r.periodId}:${r.date}`;
    const g = groupKeys.get(key) ?? {
      employeeId: r.employeeId,
      periodId: r.periodId,
      date: r.date,
      items: [],
    };
    g.items.push(r);
    groupKeys.set(key, g);
  }

  const punchesByGroup = new Map<string, Awaited<ReturnType<typeof listPunches>>>();
  for (const [key, g] of groupKeys) {
    const dayStart = localMidnightUtc(g.date, timezone);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const dayPunches = await listPunches({
      employeeId: g.employeeId,
      periodId: g.periodId,
      clockAfter: dayStart,
      clockBefore: dayEnd,
    });
    punchesByGroup.set(key, dayPunches);
  }

  return requests.map((request) => {
    const key = `${request.employeeId}:${request.periodId}:${request.date}`;
    const issue = request.alertId
      ? (issueByAlert.get(request.alertId) ?? null)
      : null;
    const review = buildMissedPunchReviewContext(
      request,
      issue,
      punchesByGroup.get(key) ?? [],
      dayKey,
    );
    return { request, review };
  });
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
    if (input.alertId) {
      const [existing] = await tx
        .select()
        .from(missedPunchRequests)
        .where(
          and(
            eq(missedPunchRequests.alertId, input.alertId),
            eq(missedPunchRequests.status, "PENDING"),
          ),
        )
        .limit(1);
      if (existing) return existing;
    }

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
    const claimedAnchor = before.claimedClockIn ?? before.claimedClockOut;
    if (!claimedAnchor) {
      throw new Error("approveMissedPunchRequest: request has no claimed punch time");
    }
    const claimedDay = dayFmt.format(claimedAnchor);
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
    const [alert] = before.alertId
      ? await tx
          .select({ issue: missedPunchAlerts.issue })
          .from(missedPunchAlerts)
          .where(eq(missedPunchAlerts.id, before.alertId))
      : [];

    let punch;
    if (alert?.issue === "UNPAIRED_PUNCH") {
      const dayPunches = await tx
        .select()
        .from(punches)
        .where(
          and(
            eq(punches.employeeId, before.employeeId),
            eq(punches.periodId, periodId),
            isNull(punches.voidedAt),
          ),
        );
      const unpaired = dayPunches.find(
        (p) =>
          dayFmt.format(p.clockIn) === before.date &&
          isAmbiguousSinglePunch(p),
      );
      if (unpaired) {
        const dayKeyFn = (d: Date) => dayFmt.format(d);
        const ctx = buildMissedPunchReviewContext(
          before,
          "UNPAIRED_PUNCH",
          dayPunches,
          dayKeyFn,
        );
        let nextClockIn = ctx.proposedClockIn ?? ctx.onFileClockIn;
        let nextClockOut = ctx.proposedClockOut ?? ctx.onFileClockOut;
        if (
          nextClockIn &&
          nextClockOut &&
          nextClockOut.getTime() <= nextClockIn.getTime() &&
          before.claimedClockOut &&
          !before.claimedClockIn
        ) {
          const anchored = anchorClaimToRequestDate(
            before.claimedClockOut,
            before.date,
            company.timezone,
          );
          if (anchored && anchored.getTime() > nextClockIn.getTime()) {
            nextClockOut = anchored;
          }
        }
        if (
          !nextClockIn ||
          !nextClockOut ||
          nextClockOut.getTime() <= nextClockIn.getTime()
        ) {
          throw new Error(
            "approveMissedPunchRequest: unpaired punch resolution must create a valid in/out range",
          );
        }
        const [updated] = await tx
          .update(punches)
          .set({
            clockIn: nextClockIn,
            clockOut: nextClockOut,
            editedById: actor.id,
            editedAt: new Date(),
            editReason: `Approved unpaired punch request ${before.id}`,
            notes: unpaired.notes
              ? `${unpaired.notes}\nApproved unpaired punch request ${before.id}`
              : `Approved unpaired punch request ${before.id}`,
          })
          .where(eq(punches.id, unpaired.id))
          .returning();
        punch = updated;
      }
    }

    if (
      alert?.issue === "MISSING_IN" &&
      before.claimedClockIn &&
      !before.claimedClockOut
    ) {
      const dayPunches = await tx
        .select()
        .from(punches)
        .where(
          and(
            eq(punches.employeeId, before.employeeId),
            eq(punches.periodId, periodId),
            isNull(punches.voidedAt),
          ),
        );
      const sentinel = dayPunches.find(
        (p) =>
          dayFmt.format(p.clockIn) === before.date &&
          isMissingClockInPunch(p),
      );
      if (sentinel) {
        const [updated] = await tx
          .update(punches)
          .set({
            clockIn: before.claimedClockIn,
            editedById: actor.id,
            editedAt: new Date(),
            editReason: `Approved missing clock-in request ${before.id}`,
            notes: sentinel.notes
              ? `${sentinel.notes}\nApproved missing clock-in request ${before.id}`
              : `Approved missing clock-in request ${before.id}`,
          })
          .where(eq(punches.id, sentinel.id))
          .returning();
        punch = updated;
      }
    }

    if (
      before.claimedClockOut &&
      (alert?.issue === "MISSING_OUT" || !before.claimedClockIn)
    ) {
      const openPunches = await tx
        .select()
        .from(punches)
        .where(
          and(
            eq(punches.employeeId, before.employeeId),
            eq(punches.periodId, periodId),
            isNull(punches.clockOut),
            isNull(punches.voidedAt),
          ),
        );
      const openPunchForRequestDate = openPunches.find(
        (p) => dayFmt.format(p.clockIn) === before.date,
      );
      if (openPunchForRequestDate) {
        const [updated] = await tx
          .update(punches)
          .set({
            clockOut: before.claimedClockOut,
            editedById: actor.id,
            editedAt: new Date(),
            editReason: `Approved missing punch request ${before.id}`,
            notes: openPunchForRequestDate.notes
              ? `${openPunchForRequestDate.notes}\nApproved missing punch request ${before.id}`
              : `Approved missing punch request ${before.id}`,
          })
          .where(eq(punches.id, openPunchForRequestDate.id))
          .returning();
        punch = updated;
      }
    }

    if (!punch && !before.claimedClockIn) {
      throw new Error(
        "approveMissedPunchRequest: clock-in is required unless an open punch can be closed",
      );
    }

    if (!punch) {
      const [inserted] = await tx
        .insert(punches)
        .values({
          employeeId: before.employeeId,
          periodId,
          clockIn: before.claimedClockIn!,
          clockOut: before.claimedClockOut ?? null,
          source: "MISSED_PUNCH_APPROVED",
          notes: `From request ${before.id}`,
        })
        .returning();
      punch = inserted;
    }
    if (!punch) throw new Error("approveMissedPunchRequest: punch upsert empty");

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
    const isCancellationChange = input.changeRequestAction === "CANCEL";

    if (!isHeadsUp && !isCancellationChange) {
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
            input.changeRequestForId
              ? ne(timeOffRequests.id, input.changeRequestForId)
              : sql`true`,
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

/** Create an employee-submitted edit or cancellation request for an
 * approved time-off row. The approved row stays active while this new
 * row waits for admin review. */
export async function createTimeOffChangeRequest(
  originalId: string,
  input: Omit<
    NewTimeOffRequest,
    "employeeId" | "status" | "changeRequestForId" | "changeRequestAction"
  >,
  action: TimeOffChangeAction,
  actor: Actor,
): Promise<TimeOffRequest> {
  const [original] = await db
    .select()
    .from(timeOffRequests)
    .where(eq(timeOffRequests.id, originalId))
    .limit(1);
  if (!original) throw new Error("TIME_OFF_CHANGE_ORIGINAL_NOT_FOUND");
  if (original.status !== "APPROVED") {
    throw new Error("TIME_OFF_CHANGE_ORIGINAL_NOT_APPROVED");
  }
  if (original.type === "SCHEDULE_NOTE") {
    throw new Error("TIME_OFF_CHANGE_SCHEDULE_NOTE");
  }
  const [pending] = await db
    .select({ id: timeOffRequests.id })
    .from(timeOffRequests)
    .where(
      and(
        eq(timeOffRequests.changeRequestForId, original.id),
        eq(timeOffRequests.status, "PENDING"),
      ),
    )
    .limit(1);
  if (pending) throw new Error("TIME_OFF_CHANGE_ALREADY_PENDING");

  return createTimeOffRequest(
    {
      ...input,
      employeeId: original.employeeId,
      startDate: action === "CANCEL" ? original.startDate : input.startDate,
      endDate: action === "CANCEL" ? original.endDate : input.endDate,
      type: action === "CANCEL" ? original.type : input.type,
      reason: input.reason ?? original.reason,
      changeRequestForId: original.id,
      changeRequestAction: action,
    },
    actor,
  );
}

/** Direct admin correction for an approved time-off entry. Employee
 * self-service changes use change rows instead; this path is for the
 * owner/admin being asked in person to correct the live approved row. */
export async function updateApprovedTimeOffRequest(
  requestId: string,
  input: Pick<NewTimeOffRequest, "startDate" | "endDate" | "type" | "reason">,
  actor: Actor,
): Promise<TimeOffRequest> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(timeOffRequests)
      .where(eq(timeOffRequests.id, requestId))
      .limit(1);
    if (!before) throw new Error("TIME_OFF_NOT_FOUND");
    if (before.status !== "APPROVED") {
      throw new Error("TIME_OFF_ADMIN_EDIT_NOT_APPROVED");
    }
    if (before.type === "SCHEDULE_NOTE") {
      throw new Error("TIME_OFF_ADMIN_EDIT_SCHEDULE_NOTE");
    }
    const [overlap] = await tx
      .select({ id: timeOffRequests.id })
      .from(timeOffRequests)
      .where(
        and(
          eq(timeOffRequests.employeeId, before.employeeId),
          ne(timeOffRequests.id, before.id),
          or(
            eq(timeOffRequests.status, "PENDING"),
            eq(timeOffRequests.status, "APPROVED"),
          ),
          sql`${timeOffRequests.type} <> 'SCHEDULE_NOTE'`,
          sql`${timeOffRequests.startDate} <= ${input.endDate}`,
          sql`${timeOffRequests.endDate} >= ${input.startDate}`,
        ),
      )
      .limit(1);
    if (overlap) throw new Error("TIME_OFF_OVERLAP");

    const [row] = await tx
      .update(timeOffRequests)
      .set({
        startDate: input.startDate,
        endDate: input.endDate,
        type: input.type,
        reason: input.reason ?? null,
        partialStartTime: null,
        partialEndTime: null,
        resolvedById: actor.id,
        resolvedAt: new Date(),
        resolutionNote: "Updated directly by admin.",
      })
      .where(eq(timeOffRequests.id, requestId))
      .returning();
    if (!row) throw new Error("TIME_OFF_ADMIN_EDIT_EMPTY");
    await writeAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: "time_off.request.admin_update",
        targetType: "TimeOffRequest",
        targetId: row.id,
        before,
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
    const changePlan =
      before.changeRequestForId && before.changeRequestAction
        ? timeOffChangeApprovalPlan(before.changeRequestAction, status)
        : null;
    const [row] = await tx
      .update(timeOffRequests)
      .set({
        status: changePlan?.resolveChangeAs ?? status,
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
    if (changePlan?.cancelOriginal && before.changeRequestForId) {
      const [originalBefore] = await tx
        .select()
        .from(timeOffRequests)
        .where(eq(timeOffRequests.id, before.changeRequestForId))
        .limit(1);
      if (originalBefore?.status === "APPROVED") {
        const [originalAfter] = await tx
          .update(timeOffRequests)
          .set({
            status: "CANCELLED",
            resolvedById: actor.id,
            resolvedAt: new Date(),
            resolutionNote:
              before.changeRequestAction === "CANCEL"
                ? "Employee cancellation approved."
                : "Replaced by approved employee change.",
          })
          .where(eq(timeOffRequests.id, before.changeRequestForId))
          .returning();
        if (originalAfter) {
          await writeAudit(
            {
              actorId: actor.id,
              actorRole: actor.role,
              action: "time_off.request.change_original_cancelled",
              targetType: "TimeOffRequest",
              targetId: originalAfter.id,
              before: originalBefore,
              after: originalAfter,
            },
            tx,
          );
        }
      }
    }
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
