"use server";

// Payday signing mode actions. Auth is the period-scoped payday cookie
// (lib/kiosk/payday.ts), minted by redeeming the 6-digit code the owner
// generated on the admin period page. NOT the employee kiosk session and
// NOT Auth.js — the owner's admin login never touches the shared tablet.

import { z } from "zod";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payPeriods, type PayPeriod } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import {
  PAYDAY_COOKIE_NAME,
  PAYDAY_SESSION_TTL_S,
  clearPaydayFailures,
  consumePaydayCode,
  openPaydayToken,
  paydayLockedUntil,
  recordPaydayFailure,
  sealPaydayToken,
} from "@/lib/kiosk/payday";
import { kioskCopy } from "@/lib/kiosk/copy";

const COOKIE_PATH = "/kiosk";

/** The period this tablet is unlocked for, or null. */
export async function requirePaydayPeriod(): Promise<PayPeriod | null> {
  const jar = await cookies();
  const payload = openPaydayToken(jar.get(PAYDAY_COOKIE_NAME)?.value);
  if (!payload) return null;
  const [period] = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.id, payload.periodId))
    .limit(1);
  return period ?? null;
}

const codeSchema = z.string().regex(/^\d{6}$/);

export async function paydayUnlockAction(
  formData: FormData,
): Promise<{ ok: true; next: string } | { error: string }> {
  const lockedUntil = paydayLockedUntil();
  if (lockedUntil) {
    const secs = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000));
    return { error: `Too many tries. Wait ${secs}s and try again.` };
  }
  const parsed = codeSchema.safeParse(String(formData.get("code") ?? ""));
  if (!parsed.success) return { error: "Enter the 6-digit code from the office." };
  const periodId = consumePaydayCode(parsed.data);
  if (!periodId) {
    recordPaydayFailure();
    return { error: "That code is not valid or has expired. Ask for a new one." };
  }
  clearPaydayFailures();
  const exp = Math.floor(Date.now() / 1000) + PAYDAY_SESSION_TTL_S;
  const jar = await cookies();
  jar.set(PAYDAY_COOKIE_NAME, sealPaydayToken({ periodId, exp }), {
    httpOnly: true,
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: PAYDAY_SESSION_TTL_S,
  });
  await writeAudit({
    actorId: null,
    actorRole: "EMPLOYEE",
    action: "kiosk.payday.unlock",
    targetType: "PayPeriod",
    targetId: periodId,
  });
  return { ok: true, next: "/kiosk/payday/list" };
}

export async function paydayEndAction(): Promise<void> {
  const jar = await cookies();
  // Path MUST match the set-cookie path (see kioskLogoutAction).
  jar.delete({ name: PAYDAY_COOKIE_NAME, path: COOKIE_PATH });
  redirect("/kiosk");
}

const signSchema = z.object({
  payslipId: z.string().uuid(),
  signature: z.string().min(1),
});

/**
 * Owner-driven e-signature: the payslip must belong to the unlocked
 * period and be published. Identity is the drawn signature itself — the
 * owner is standing there handing the tablet over.
 */
export async function paydaySignPayslipAction(
  formData: FormData,
): Promise<{ ok: true; next: string } | { error: string }> {
  const period = await requirePaydayPeriod();
  if (!period) return { ok: true, next: "/kiosk/payday" };
  const parsed = signSchema.safeParse({
    payslipId: formData.get("payslipId"),
    signature: formData.get("signature"),
  });
  const cEn = kioskCopy("en");
  if (!parsed.success) return { error: cEn.paySignEmpty };
  const { getPayslipById } = await import("@/lib/db/queries/payslips");
  const slip = await getPayslipById(parsed.data.payslipId);
  if (!slip || slip.periodId !== period.id || slip.voidedAt || !slip.publishedAt) {
    return { ok: true, next: "/kiosk/payday/list" };
  }
  const { employees } = await import("@/lib/db/schema");
  const [employee] = await db
    .select({ language: employees.language })
    .from(employees)
    .where(eq(employees.id, slip.employeeId))
    .limit(1);
  const c = kioskCopy(employee?.language === "es" ? "es" : "en");
  const { signPayslipFromPad } = await import("@/lib/payslips/sign-flow");
  const result = await signPayslipFromPad({
    slip,
    signature: parsed.data.signature,
    via: "PAYDAY",
    copy: { empty: c.paySignEmpty, error: c.paySignError },
  });
  if ("error" in result) return result;
  return { ok: true, next: "/kiosk/payday/list?signed=1" };
}
