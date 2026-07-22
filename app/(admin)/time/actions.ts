"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-guards";
import {
  createBackPayPunch,
  createPunch,
  editPunch,
  voidPunch,
} from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { wallClockToUtc, isBareWallClock } from "@/lib/time/wall-clock";
import { buildTimeEditorHref } from "@/lib/time/grid-links";
import {
  NGTECO_MANUAL_PUNCH_SYNC_QUEUE,
  type ManualPunchSyncJobData,
} from "@/lib/ngteco/manual-punch-sync";

/**
 * Parse a punch-editor datetime-local string as company-timezone
 * wall-clock and return the UTC Date. Owner: "everything should be in
 * EST... there is no other time zones". Without this, the LXC's UTC
 * locale would re-interpret "2026-05-04T20:00" as 8 PM UTC instead of
 * 8 PM ET.
 */
async function parsePunchInput(input: string): Promise<Date | null> {
  if (isBareWallClock(input)) {
    const company = await getSetting("company");
    return wallClockToUtc(input, company.timezone);
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Sanity check punches before they hit the DB. Rejects nonsense pairs
 * that the UI defaults could otherwise produce: clockOut at-or-before
 * clockIn, or a span longer than the company's longest plausible
 * shift (16h hard cap).
 */
const MAX_PUNCH_SPAN_MS = 16 * 60 * 60 * 1000;
function validatePunchSpan(
  clockIn: Date,
  clockOut: Date | null,
): string | null {
  if (!clockOut) return null;
  const span = clockOut.getTime() - clockIn.getTime();
  if (span <= 0) return "Clock-out must be after clock-in.";
  if (span > MAX_PUNCH_SPAN_MS) {
    return `Punch span over 16 hours — that's almost certainly wrong. Adjust the times.`;
  }
  return null;
}

async function queueNgtecoPunchSync(
  punchId: string,
  actor: { id: string; role: ManualPunchSyncJobData["actorRole"] },
): Promise<void> {
  try {
    const { getBoss } = await import("@/lib/jobs");
    const boss = await getBoss();
    await boss.send(NGTECO_MANUAL_PUNCH_SYNC_QUEUE, {
      punchId,
      actorId: actor.id,
      actorRole: actor.role,
    } satisfies ManualPunchSyncJobData);
  } catch {
    // Milo is the payroll source of truth. A queue outage should not roll
    // back the payroll correction the admin just made.
  }
}

// ISO datetime regex — input must be e.g. "2026-04-15T07:30" or
// "2026-04-15T07:30:00Z". Without this, garbage like "2026-13-99"
// parses via Date overflow rollover and lands a punch on the wrong day.
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

const createSchema = z.object({
  employeeId: z.string().uuid(),
  periodId: z.string().uuid(),
  clockIn: z.string().regex(ISO_DATETIME_RE, "clockIn must be ISO datetime"),
  clockOut: z
    .string()
    .regex(ISO_DATETIME_RE, "clockOut must be ISO datetime")
    .optional()
    .nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export async function createPunchAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = createSchema.safeParse({
    employeeId: formData.get("employeeId"),
    periodId: formData.get("periodId"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut") || null,
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const clockInD = await parsePunchInput(parsed.data.clockIn);
  const clockOutD = parsed.data.clockOut
    ? await parsePunchInput(parsed.data.clockOut)
    : null;
  if (!clockInD) return { error: "Invalid clock-in." };
  if (parsed.data.clockOut && !clockOutD) {
    return { error: "Invalid clock-out." };
  }
  const spanErr = validatePunchSpan(clockInD, clockOutD);
  if (spanErr) return { error: spanErr };
  try {
    const punch = await createPunch(
      {
        employeeId: parsed.data.employeeId,
        periodId: parsed.data.periodId,
        clockIn: clockInD,
        clockOut: clockOutD,
        source: "MANUAL_ADMIN",
        notes: parsed.data.notes ?? null,
      },
      { id: session.user.id, role: session.user.role },
    );
    await queueNgtecoPunchSync(punch.id, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "PERIOD_PAID") {
      return { error: "Period is paid. Unmark paid before editing punches." };
    }
    if (err instanceof Error && err.message === "PUNCH_OUT_OF_PERIOD") {
      return {
        error:
          "Punch falls outside this pay period's date range. Open the correct period or fix the times.",
      };
    }
    throw err;
  }
  revalidatePath("/time");
  const date = String(formData.get("date") ?? "");
  const returnTo =
    typeof formData.get("returnTo") === "string"
      ? String(formData.get("returnTo"))
      : undefined;
  redirect(
    buildTimeEditorHref({
      periodId: parsed.data.periodId,
      date,
      employeeId: parsed.data.employeeId,
      returnTo,
    }),
  );
}

const backPaySchema = z.object({
  employeeId: z.string().uuid(),
  workDate: z.string().date(),
  clockIn: z.string().regex(ISO_DATETIME_RE, "clockIn must be ISO datetime"),
  clockOut: z.string().regex(ISO_DATETIME_RE, "clockOut must be ISO datetime"),
  reason: z.string().min(1).max(500),
});

/**
 * Record a shift from an already-PAID week as back pay in the employee's
 * current period. Entered from the day editor when the period is paid —
 * the punch keeps its true worked timestamps, the money lands in the
 * next run, and paid history stays frozen.
 */
export async function createBackPayPunchAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = backPaySchema.safeParse({
    employeeId: formData.get("employeeId"),
    workDate: formData.get("workDate"),
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const clockInD = await parsePunchInput(parsed.data.clockIn);
  const clockOutD = await parsePunchInput(parsed.data.clockOut);
  if (!clockInD) return { error: "Invalid clock-in." };
  if (!clockOutD) return { error: "Invalid clock-out." };
  const spanErr = validatePunchSpan(clockInD, clockOutD);
  if (spanErr) return { error: spanErr };
  try {
    await createBackPayPunch(
      {
        employeeId: parsed.data.employeeId,
        clockIn: clockInD,
        clockOut: clockOutD,
        workDate: parsed.data.workDate,
        reason: parsed.data.reason,
      },
      { id: session.user.id, role: session.user.role },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "PERIOD_PAID") {
      return {
        error:
          "Today's pay period is already paid too — unmark it as paid first.",
      };
    }
    return {
      error: err instanceof Error ? err.message : "Could not add back pay.",
    };
  }
  revalidatePath("/time");
  revalidatePath("/payroll");
  const returnTo =
    typeof formData.get("returnTo") === "string"
      ? String(formData.get("returnTo"))
      : undefined;
  redirect(returnTo || "/time");
}

const editSchema = z.object({
  clockIn: z.string().regex(ISO_DATETIME_RE, "clockIn must be ISO datetime"),
  clockOut: z
    .string()
    .regex(ISO_DATETIME_RE, "clockOut must be ISO datetime")
    .optional()
    .nullable(),
  reason: z.string().min(1).max(500),
  notes: z.string().max(500).optional().nullable(),
});

export async function editPunchAction(
  punchId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = editSchema.safeParse({
    clockIn: formData.get("clockIn"),
    clockOut: formData.get("clockOut") || null,
    reason: formData.get("reason"),
    notes: formData.get("notes") || null,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const clockInD = await parsePunchInput(parsed.data.clockIn);
  const clockOutD = parsed.data.clockOut
    ? await parsePunchInput(parsed.data.clockOut)
    : null;
  if (!clockInD) return { error: "Invalid clock-in." };
  if (parsed.data.clockOut && !clockOutD) {
    return { error: "Invalid clock-out." };
  }
  const spanErr = validatePunchSpan(clockInD, clockOutD);
  if (spanErr) return { error: spanErr };
  try {
    const punch = await editPunch(
      punchId,
      { clockIn: clockInD, clockOut: clockOutD, notes: parsed.data.notes ?? null },
      parsed.data.reason,
      { id: session.user.id, role: session.user.role },
    );
    await queueNgtecoPunchSync(punch.id, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "PERIOD_PAID") {
      return { error: "Period is paid. Unmark paid before editing punches." };
    }
    if (err instanceof Error && err.message === "PUNCH_OUT_OF_PERIOD") {
      return {
        error:
          "Punch falls outside this pay period's date range. Open the correct period or fix the times.",
      };
    }
    throw err;
  }
  revalidatePath("/time");
}

const voidSchema = z.object({ reason: z.string().min(1).max(500) });

export async function voidPunchAction(
  punchId: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = voidSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  try {
    await voidPunch(punchId, parsed.data.reason, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "PERIOD_PAID") {
      return { error: "Period is paid. Unmark paid before voiding punches." };
    }
    throw err;
  }
  revalidatePath("/time");
}
