"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import { getSetting } from "@/lib/settings/runtime";
import {
  approveMissedPunchRequest,
  createTimeOffRequest,
  rejectMissedPunchRequest,
  resolveTimeOffRequest,
  getMissedPunchRequest,
  updateApprovedTimeOffRequest,
} from "@/lib/db/queries/requests";
import {
  cancelTimeOffRequest,
  getTimeOffRequest,
} from "@/lib/db/queries/time-off";
import {
  userIdForEmployee,
} from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";
import {
  NGTECO_MANUAL_PUNCH_SYNC_QUEUE,
  type ManualPunchSyncJobData,
} from "@/lib/ngteco/manual-punch-sync";

const idSchema = z.string().uuid();

const approveSchema = z.object({
  resolutionNote: z.string().max(500).optional().nullable(),
});

export async function approveMissedPunchAction(
  requestId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(requestId).success) return { error: "Invalid id." };
  const parsed = approveSchema.safeParse({
    resolutionNote: formData.get("resolutionNote") || null,
  });
  if (!parsed.success) return { error: "Invalid input." };
  const before = await getMissedPunchRequest(requestId);
  if (!before) return { error: "Not found." };
  let resolved;
  try {
    resolved = await approveMissedPunchRequest(
      requestId,
      parsed.data.resolutionNote ?? null,
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes(
          "clock-in is required unless an open punch can be closed",
        )
      ) {
        return {
          error:
            "This request only has a clock-out time, but Milo could not find an open punch to close. Ask the employee for the clock-in too, or add the punch manually.",
        };
      }
      if (
        err.message.includes(
          "unpaired punch resolution must create a valid in/out range",
        )
      ) {
        return {
          error:
            "The claimed time does not pair correctly with the punch on file. Reject and ask the employee to re-submit with the correct missing clock-in or clock-out.",
        };
      }
      if (err.message.includes("no claimed punch time")) {
        return { error: "This request has no punch time to approve." };
      }
    }
    throw err;
  }
  // Notify the employee.
  const recipientId = await userIdForEmployee(before.employeeId);
  if (recipientId) {
    await dispatch([
      {
        recipientId,
        kind: "missed_punch.request_resolved",
        payload: { requestId, status: "APPROVED" },
      },
    ]);
  }
  if (resolved.resultingPunchId) {
    try {
      const { getBoss } = await import("@/lib/jobs");
      const boss = await getBoss();
      await boss.send(NGTECO_MANUAL_PUNCH_SYNC_QUEUE, {
        punchId: resolved.resultingPunchId,
        actorId: session.user.id,
        actorRole: session.user.role,
      } satisfies ManualPunchSyncJobData);
    } catch {
      // Payroll is already corrected in Milo. Do not fail the approval path
      // if the background queue is temporarily unavailable.
    }
  }
  revalidatePath(`/me/time/${before.date}`);
  revalidatePath("/me/time");
  revalidatePath(`/payroll/${before.periodId}`);
  if (resolved.periodId !== before.periodId) {
    revalidatePath(`/payroll/${resolved.periodId}`);
  }
  revalidatePath("/requests");
  revalidatePath("/calendar");
  revalidatePath("/me/home");
}

const rejectSchema = z.object({
  resolutionNote: z.string().min(1).max(500),
});

export async function rejectMissedPunchAction(
  requestId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(requestId).success) return { error: "Invalid id." };
  const parsed = rejectSchema.safeParse({
    resolutionNote: formData.get("resolutionNote"),
  });
  if (!parsed.success) return { error: "Reason required." };
  const before = await getMissedPunchRequest(requestId);
  if (!before) return { error: "Not found." };
  await rejectMissedPunchRequest(requestId, parsed.data.resolutionNote, {
    id: session.user.id,
    role: session.user.role,
  });
  const recipientId = await userIdForEmployee(before.employeeId);
  if (recipientId) {
    await dispatch([
      {
        recipientId,
        kind: "missed_punch.request_resolved",
        payload: { requestId, status: "REJECTED" },
      },
    ]);
  }
  revalidatePath("/requests");
}

const timeOffResolveSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  resolutionNote: z.string().max(500).optional().nullable(),
});

export async function resolveTimeOffAction(
  requestId: string,
  employeeId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(requestId).success) return { error: "Invalid id." };
  const parsed = timeOffResolveSchema.safeParse({
    status: formData.get("status"),
    resolutionNote: formData.get("resolutionNote") || null,
  });
  if (!parsed.success) return { error: "Invalid input." };
  const before = await getTimeOffRequest(requestId);
  if (!before) return { error: "Not found." };
  const resolved = await resolveTimeOffRequest(
    requestId,
    parsed.data.status,
    parsed.data.resolutionNote ?? null,
    { id: session.user.id, role: session.user.role },
  );
  const recipientId = await userIdForEmployee(employeeId);
  if (recipientId) {
    await dispatch([
      {
        recipientId,
        kind: "time_off.request_resolved",
        payload: { requestId, status: resolved.status },
      },
    ]);
  }

  // Push to Google Calendar on APPROVED, delete on REJECTED (in case
  // an earlier approval pushed it). Best-effort — a calendar failure
  // shouldn't block the resolution.
  try {
    const cfg = await getSetting("googleCalendar");
    if (cfg.refreshTokenSealed && cfg.calendarId) {
      const { db } = await import("@/lib/db");
      const { timeOffRequests, employees } = await import("@/lib/db/schema");
      const [details] = await db
        .select({
          startDate: timeOffRequests.startDate,
          endDate: timeOffRequests.endDate,
          type: timeOffRequests.type,
          reason: timeOffRequests.reason,
          employeeName: employees.displayName,
        })
        .from(timeOffRequests)
        .innerJoin(employees, eq(employees.id, timeOffRequests.employeeId))
        .where(eq(timeOffRequests.id, requestId));
      if (details) {
        const { pushTimeOffEvent, deleteTimeOffEvent } = await import(
          "@/lib/google/calendar"
        );
        if (resolved.status === "APPROVED") {
          // Google's all-day "end" is exclusive; bump endDate by 1 day.
          const end = new Date(`${details.endDate}T00:00:00Z`);
          end.setUTCDate(end.getUTCDate() + 1);
          await pushTimeOffEvent({
            externalId: requestId,
            summary: `${details.employeeName} — ${details.type.toLowerCase()}`,
            description: details.reason ?? "",
            startDate: details.startDate,
            endDateExclusive: end.toISOString().slice(0, 10),
          });
        } else {
          await deleteTimeOffEvent(requestId);
        }
        if (
          parsed.data.status === "APPROVED" &&
          before.changeRequestForId &&
          before.changeRequestAction
        ) {
          await deleteTimeOffEvent(before.changeRequestForId);
        }
      }
    }
  } catch (err) {
    // Silent on UX path — log only. Owner sees a status pill on
    // /settings/google-calendar (lastPushedAt) to verify pushes.
    const { logger } = await import("@/lib/telemetry");
    logger.warn({ err, requestId }, "google.calendar.push_failed");
  }

  revalidatePath("/requests");
  revalidatePath("/calendar");
  revalidatePath("/me/home");
}

const cancelSchema = z.object({
  resolutionNote: z.string().max(500).optional().nullable(),
});

/** Admin-cancel a time-off request — handles both PENDING (rare) and
 *  APPROVED (the actual case: "she asked off but actually came in").
 *  When cancelling an APPROVED one, also pull the Google Calendar
 *  event so the owner's calendar reflects reality. */
export async function adminCancelTimeOffAction(
  requestId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(requestId).success) return { error: "Invalid id." };
  const parsed = cancelSchema.safeParse({
    resolutionNote: formData.get("resolutionNote") || null,
  });
  if (!parsed.success) return { error: "Invalid input." };
  const before = await getTimeOffRequest(requestId);
  if (!before) return { error: "Not found." };
  if (before.status === "CANCELLED") return; // idempotent
  await cancelTimeOffRequest(
    requestId,
    session.user.id,
    parsed.data.resolutionNote ?? null,
  );

  // If it was previously APPROVED, the calendar event was pushed —
  // pull it back. Best-effort, like the resolve flow.
  if (before.status === "APPROVED") {
    try {
      const cfg = await getSetting("googleCalendar");
      if (cfg.refreshTokenSealed && cfg.calendarId) {
        const { deleteTimeOffEvent } = await import("@/lib/google/calendar");
        await deleteTimeOffEvent(requestId);
      }
    } catch (err) {
      const { logger } = await import("@/lib/telemetry");
      logger.warn({ err, requestId }, "google.calendar.cancel_failed");
    }
  }

  // Notify the employee — symmetric with the resolve flow.
  const recipientId = await userIdForEmployee(before.employeeId);
  if (recipientId) {
    await dispatch([
      {
        recipientId,
        kind: "time_off.request_resolved",
        payload: { requestId, status: "CANCELLED" },
      },
    ]);
  }

  revalidatePath("/requests");
  revalidatePath("/calendar");
  revalidatePath("/me/home");
}

const adminUpdateSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["UNPAID", "SICK", "PERSONAL", "OTHER"]),
  reason: z.string().max(500).optional().nullable(),
});

export async function adminUpdateTimeOffAction(
  requestId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(requestId).success) return { error: "Invalid id." };
  const parsed = adminUpdateSchema.safeParse({
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    type: formData.get("type"),
    reason: formData.get("reason") || null,
  });
  if (!parsed.success) return { error: "Invalid input." };
  if (parsed.data.startDate > parsed.data.endDate) {
    return { error: "Start date must be on or before end date." };
  }
  let updated;
  try {
    updated = await updateApprovedTimeOffRequest(
      requestId,
      {
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        type: parsed.data.type,
        reason: parsed.data.reason ?? null,
      },
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "TIME_OFF_OVERLAP") {
      return { error: "This change overlaps another pending or approved request." };
    }
    if (err instanceof Error && err.message === "TIME_OFF_ADMIN_EDIT_NOT_APPROVED") {
      return { error: "Only approved time off can be edited directly." };
    }
    throw err;
  }

  const recipientId = await userIdForEmployee(updated.employeeId);
  if (recipientId) {
    await dispatch([
      {
        recipientId,
        kind: "time_off.request_resolved",
        payload: { requestId, status: "APPROVED", adminUpdated: true },
      },
    ]);
  }
  try {
    const cfg = await getSetting("googleCalendar");
    if (cfg.refreshTokenSealed && cfg.calendarId) {
      const { db } = await import("@/lib/db");
      const { employees } = await import("@/lib/db/schema");
      const [employee] = await db
        .select({ displayName: employees.displayName })
        .from(employees)
        .where(eq(employees.id, updated.employeeId));
      if (employee) {
        const { pushTimeOffEvent } = await import("@/lib/google/calendar");
        const end = new Date(`${updated.endDate}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        await pushTimeOffEvent({
          externalId: updated.id,
          summary: `${employee.displayName} — ${updated.type.toLowerCase()}`,
          description: updated.reason ?? "",
          startDate: updated.startDate,
          endDateExclusive: end.toISOString().slice(0, 10),
        });
      }
    }
  } catch (err) {
    const { logger } = await import("@/lib/telemetry");
    logger.warn({ err, requestId }, "google.calendar.admin_update_failed");
  }
  revalidatePath("/calendar");
  revalidatePath("/me/home");
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-side time-off entry. When an employee asks the owner directly for time
// off (verbal, text, in person), this lets the owner record it on their behalf
// pre-approved. Same row shape as a normal employee-submitted request, just
// with status APPROVED from the start. Pushes to Google Calendar identically
// to a resolve-approve, so the calendar sees both flows the same way.
// ─────────────────────────────────────────────────────────────────────────────

const createOnBehalfSchema = z.object({
  employeeId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(["UNPAID", "SICK", "PERSONAL", "OTHER"]),
  reason: z.string().max(500).optional().nullable(),
});

export async function createTimeOffOnBehalfAction(
  formData: FormData,
): Promise<{ error?: string; id?: string } | void> {
  const session = await requireAdmin();
  const parsed = createOnBehalfSchema.safeParse({
    employeeId: formData.get("employeeId"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    type: formData.get("type"),
    reason: formData.get("reason") || null,
  });
  if (!parsed.success) return { error: "Invalid input." };
  if (parsed.data.startDate > parsed.data.endDate) {
    return { error: "Start date must be on or before end date." };
  }

  // Create as APPROVED directly — this is admin recording an arrangement
  // they already agreed to, not employee → admin → resolve. resolvedById /
  // resolvedAt point at the admin so audit history reads cleanly.
  let created;
  try {
    created = await createTimeOffRequest(
      {
        employeeId: parsed.data.employeeId,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        type: parsed.data.type,
        reason: parsed.data.reason ?? null,
        status: "APPROVED",
        resolvedById: session.user.id,
        resolvedAt: new Date(),
        resolutionNote: "Recorded by admin on behalf of employee.",
      },
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "TIME_OFF_OVERLAP") {
      return {
        error:
          "Employee already has a pending or approved time-off request overlapping these dates.",
      };
    }
    throw err;
  }

  // Notify the employee — push + in-app — so they see the time off appear
  // on their portal calendar even though they never opened a ticket.
  const recipientId = await userIdForEmployee(parsed.data.employeeId);
  if (recipientId) {
    await dispatch([
      {
        recipientId,
        kind: "time_off.request_resolved",
        payload: { requestId: created.id, status: "APPROVED" },
      },
    ]);
  }

  // Push to Google Calendar (same path as the resolve flow).
  try {
    const cfg = await getSetting("googleCalendar");
    if (cfg.refreshTokenSealed && cfg.calendarId) {
      const { db } = await import("@/lib/db");
      const { employees: employeesTbl } = await import("@/lib/db/schema");
      const [emp] = await db
        .select({ displayName: employeesTbl.displayName })
        .from(employeesTbl)
        .where(eq(employeesTbl.id, parsed.data.employeeId));
      if (emp) {
        const { pushTimeOffEvent } = await import("@/lib/google/calendar");
        const end = new Date(`${parsed.data.endDate}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        await pushTimeOffEvent({
          externalId: created.id,
          summary: `${emp.displayName} — ${parsed.data.type.toLowerCase()}`,
          description: parsed.data.reason ?? "",
          startDate: parsed.data.startDate,
          endDateExclusive: end.toISOString().slice(0, 10),
        });
      }
    }
  } catch (err) {
    const { logger } = await import("@/lib/telemetry");
    logger.warn(
      { err, requestId: created.id },
      "google.calendar.push_failed (on_behalf)",
    );
  }

  revalidatePath("/requests");
  revalidatePath("/calendar");
  revalidatePath("/time");
  return { id: created.id };
}
