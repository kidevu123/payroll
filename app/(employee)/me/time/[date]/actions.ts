"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import {
  createMissedPunchRequest,
  DuplicatePendingRequestError,
} from "@/lib/db/queries/requests";
import { resolvePeriodIdForEmployeeDay } from "@/lib/db/queries/pay-periods";
import { adminUserIds } from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";
import { getSetting } from "@/lib/settings/runtime";
import { parseMissedPunchClaim } from "@/lib/missed-punch/claim";
import { safeFixReturnPath } from "@/lib/missed-punch/fixable-days";
import { companyDayIso } from "@/lib/time/company-day";

const schema = z.object({
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
 * Report a punch fix from the day-detail page. Unlike the alert-driven
 * flow this doesn't require a missedPunchAlert row — the employee can
 * file the request whenever they spot a mistake. The admin reviews on
 * /requests just like the alert-driven ones.
 */
export async function reportPunchFixAction(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireSession();
  if (!session.user.employeeId) return { error: "Account not linked." };
  const parsed = schema.safeParse({
    date: formData.get("date"),
    issue: formData.get("issue") || null,
    claimedClockIn: formData.get("claimedClockIn"),
    claimedClockOut: formData.get("claimedClockOut") || null,
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const company = await getSetting("company");
  const claimInput = {
    claimedClockIn: parsed.data.claimedClockIn,
    claimedClockOut: parsed.data.claimedClockOut,
    timezone: company.timezone,
    date: parsed.data.date,
    ...(parsed.data.issue ? { issue: parsed.data.issue } : {}),
  };
  const claim = parseMissedPunchClaim(claimInput);
  if (!claim.ok) return { error: claim.error };

  // A whole-day entry (no punch on file to complete) for a day that is over
  // needs both ends. A lone clock-in would be approved as a shift that never
  // closes and pays zero hours, which is the problem the employee came to fix.
  // Today is exempt: they may still be working.
  if (
    !parsed.data.issue &&
    !claim.clockOut &&
    parsed.data.date !== companyDayIso(new Date(), company.timezone)
  ) {
    return {
      error: "Enter both the time you started and the time you finished.",
    };
  }

  // Schedule-aware, deterministic resolution — the ad-hoc unordered limit(1)
  // picked an arbitrary period when multiple pay schedules overlapped the date.
  const periodId = await resolvePeriodIdForEmployeeDay(
    session.user.employeeId,
    parsed.data.date,
  );
  if (!periodId) {
    return {
      error: "No pay period covers that date yet — ask an admin to open one.",
    };
  }

  try {
    await createMissedPunchRequest(
      {
        employeeId: session.user.employeeId,
        periodId,
        date: parsed.data.date,
        claimedClockIn: claim.clockIn,
        claimedClockOut: claim.clockOut,
        reason: parsed.data.reason,
      },
      { id: session.user.id, role: session.user.role },
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
        payload: {
          date: parsed.data.date,
          employeeId: session.user.employeeId!,
        },
      })),
    );
  }

  revalidatePath(`/me/time/${parsed.data.date}`);
  revalidatePath("/me/home");
  revalidatePath("/calendar");
  // Back to where they started (their payslip or the week list) when the
  // form was opened from there; otherwise stay on the day.
  const returnTo = safeFixReturnPath(
    typeof formData.get("returnTo") === "string"
      ? (formData.get("returnTo") as string)
      : null,
  );
  if (returnTo) {
    revalidatePath(returnTo);
    redirect(`${returnTo}?fixSent=1`);
  }
  redirect(`/me/time/${parsed.data.date}?reported=1`);
}
