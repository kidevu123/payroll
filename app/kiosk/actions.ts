"use server";

// Warehouse kiosk server actions. Auth is the kiosk PIN session cookie
// (lib/kiosk/session.ts), NOT Auth.js — every action revalidates it.

import { z } from "zod";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth";
import { writeAudit } from "@/lib/db/audit";
import {
  KIOSK_COOKIE_NAME,
  KIOSK_SESSION_TTL_S,
  clearKioskPinFailures,
  kioskPinLockedUntil,
  openKioskToken,
  recordKioskPinFailure,
  sealKioskToken,
} from "@/lib/kiosk/session";
import {
  createMissedPunchRequest,
  DuplicatePendingRequestError,
} from "@/lib/db/queries/requests";
import { resolvePeriodIdForEmployeeDay } from "@/lib/db/queries/pay-periods";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";
import { getSetting } from "@/lib/settings/runtime";
import { parseMissedPunchClaim } from "@/lib/missed-punch/claim";

const loginSchema = z.object({
  clockId: z.string().min(1).max(64),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4-6 digits"),
});

export async function kioskLoginAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const parsed = loginSchema.safeParse({
    clockId: String(formData.get("clockId") ?? "").trim(),
    pin: String(formData.get("pin") ?? ""),
  });
  if (!parsed.success) {
    return { error: "Enter your clock ID and 4-6 digit PIN." };
  }
  const { clockId, pin } = parsed.data;

  const lockedUntil = kioskPinLockedUntil(clockId);
  if (lockedUntil) {
    const mins = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000));
    return {
      error: `Too many tries. Wait ${mins} minute${mins === 1 ? "" : "s"} and try again.`,
    };
  }

  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.ngtecoEmployeeRef, clockId))
    .limit(1);

  const genericError = { error: "Wrong clock ID or PIN. Ask the office if you need a PIN." };
  if (!employee || employee.status !== "ACTIVE" || !employee.kioskPinHash) {
    recordKioskPinFailure(clockId);
    return genericError;
  }
  const ok = await verifyPassword(pin, employee.kioskPinHash);
  if (!ok) {
    recordKioskPinFailure(clockId);
    return genericError;
  }
  clearKioskPinFailures(clockId);

  const token = sealKioskToken({
    employeeId: employee.id,
    exp: Math.floor(Date.now() / 1000) + KIOSK_SESSION_TTL_S,
  });
  const jar = await cookies();
  jar.set(KIOSK_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/kiosk",
    maxAge: KIOSK_SESSION_TTL_S,
  });
  const [linkedUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.employeeId, employee.id))
    .limit(1);
  await writeAudit({
    actorId: linkedUser?.id ?? null,
    actorRole: "EMPLOYEE",
    action: "kiosk.login",
    targetType: "Employee",
    targetId: employee.id,
  });
  redirect("/kiosk/home");
}

export async function kioskLogoutAction(): Promise<void> {
  const jar = await cookies();
  // Path MUST match the set-cookie path — a bare delete() defaults to
  // path "/" and the browser keeps the /kiosk-scoped cookie, which made
  // auto-logout bounce straight back into the session.
  jar.delete({ name: KIOSK_COOKIE_NAME, path: "/kiosk" });
  redirect("/kiosk");
}

/** Employee row for the current kiosk session, or null. */
export async function requireKioskEmployee() {
  const jar = await cookies();
  const payload = openKioskToken(jar.get(KIOSK_COOKIE_NAME)?.value);
  if (!payload) return null;
  const [employee] = await db
    .select()
    .from(employees)
    .where(eq(employees.id, payload.employeeId))
    .limit(1);
  if (!employee || employee.status !== "ACTIVE") return null;
  return employee;
}

const reportSchema = z.object({
  date: z.string().date(),
  issue: z
    .enum(["MISSING_IN", "MISSING_OUT", "UNPAIRED_PUNCH", "NO_PUNCH"])
    .optional()
    .nullable(),
  claimedClockIn: z.string().optional().nullable(),
  claimedClockOut: z.string().optional().nullable(),
  reason: z.string().min(1).max(500),
});

/**
 * Kiosk twin of the employee portal's reportPunchFixAction — same claim
 * parsing, same request queue, kiosk cookie instead of Auth.js session.
 */
export async function kioskReportPunchFixAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const parsed = reportSchema.safeParse({
    date: formData.get("date"),
    issue: formData.get("issue") || null,
    claimedClockIn: formData.get("claimedClockIn") || null,
    claimedClockOut: formData.get("claimedClockOut") || null,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const company = await getSetting("company");
  const claim = parseMissedPunchClaim({
    claimedClockIn: parsed.data.claimedClockIn,
    claimedClockOut: parsed.data.claimedClockOut,
    timezone: company.timezone,
    date: parsed.data.date,
    ...(parsed.data.issue ? { issue: parsed.data.issue } : {}),
  });
  if (!claim.ok) return { error: claim.error };

  const periodId = await resolvePeriodIdForEmployeeDay(
    employee.id,
    parsed.data.date,
  );
  const [linkedUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.employeeId, employee.id))
    .limit(1);
  const linkedUserId = linkedUser?.id ?? null;
  if (!periodId) {
    return { error: "No pay period covers that date yet — ask the office." };
  }

  try {
    await createMissedPunchRequest(
      {
        employeeId: employee.id,
        periodId,
        date: parsed.data.date,
        claimedClockIn: claim.clockIn,
        claimedClockOut: claim.clockOut,
        reason: `[kiosk] ${parsed.data.reason}`,
      },
      { id: linkedUserId, role: "EMPLOYEE" },
    );
  } catch (err) {
    if (err instanceof DuplicatePendingRequestError) {
      return { error: err.message };
    }
    throw err;
  }
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatch(
      admins.map((id) => ({
        recipientId: id,
        kind: "missed_punch.request_submitted" as const,
        payload: { date: parsed.data.date, employeeId: employee.id },
      })),
    );
  }
  redirect("/kiosk/home?sent=1");
}

/**
 * Cookie clear WITHOUT redirect — the idle watcher calls this then
 * navigates client-side (a redirect() from a directly-invoked action
 * is less reliable than router.replace on some webviews/kiosk browsers).
 */
export async function kioskClearSessionAction(): Promise<void> {
  const jar = await cookies();
  jar.delete({ name: KIOSK_COOKIE_NAME, path: "/kiosk" });
}

const acknowledgeSchema = z.object({ payslipId: z.string().uuid() });

/** Approve (acknowledge) a published payslip from the kiosk. */
export async function kioskAcknowledgePayslipAction(
  formData: FormData,
): Promise<void> {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const parsed = acknowledgeSchema.safeParse({
    payslipId: formData.get("payslipId"),
  });
  // Invalid/foreign ids just land back on the list — the card only
  // renders the employee's own published payslips, so this is an edge.
  if (!parsed.success) redirect("/kiosk/pay");
  const { listPublishedPayslipsForEmployee, markAcknowledged } = await import(
    "@/lib/db/queries/payslips"
  );
  // Ownership + published gate: only this employee's portal-visible
  // payslips are acknowledgeable from the kiosk.
  const mine = await listPublishedPayslipsForEmployee(employee.id);
  const slip = mine.find((p) => p.id === parsed.data.payslipId);
  if (!slip) redirect("/kiosk/pay");
  const [linkedUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.employeeId, employee.id))
    .limit(1);
  await markAcknowledged(slip.id, {
    id: linkedUser?.id ?? null,
    role: "EMPLOYEE",
  });
  redirect("/kiosk/pay?acked=1");
}

const timeOffSchema = z.object({
  type: z.enum(["SICK", "PERSONAL", "UNPAID", "OTHER"]),
  startDate: z.string().date(),
  endDate: z.string().date(),
});

/** Quick time-off request from the kiosk — same queue as the portal. */
export async function kioskTimeOffAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const employee = await requireKioskEmployee();
  if (!employee) redirect("/kiosk");
  const parsed = timeOffSchema.safeParse({
    type: formData.get("type"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate") || formData.get("startDate"),
  });
  if (!parsed.success) return { error: "DATES_INVALID" };
  if (parsed.data.endDate < parsed.data.startDate) {
    return { error: "DATES_BACKWARDS" };
  }
  const { createTimeOffRequest } = await import("@/lib/db/queries/requests");
  const [linkedUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.employeeId, employee.id))
    .limit(1);
  try {
    await createTimeOffRequest(
      {
        employeeId: employee.id,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        type: parsed.data.type,
        reason: "[kiosk]",
      },
      { id: linkedUser?.id ?? null, role: "EMPLOYEE" },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "TIME_OFF_OVERLAP") {
      return { error: "TIME_OFF_OVERLAP" };
    }
    throw err;
  }
  const admins = await adminUserIds();
  if (admins.length > 0) {
    await dispatch(
      admins.map((id) => ({
        recipientId: id,
        kind: "time_off.request_submitted" as const,
        payload: {
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
          type: parsed.data.type,
        },
      })),
    );
  }
  redirect("/kiosk/home?sent=1");
}
