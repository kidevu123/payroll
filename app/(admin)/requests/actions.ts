"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import {
  approveMissedPunchRequest,
  rejectMissedPunchRequest,
  resolveTimeOffRequest,
  getMissedPunchRequest,
} from "@/lib/db/queries/requests";
import {
  userIdForEmployee,
} from "@/lib/db/queries/recipients";
import { dispatch } from "@/lib/notifications/router";

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
  await approveMissedPunchRequest(
    requestId,
    parsed.data.resolutionNote ?? null,
    { id: session.user.id, role: session.user.role },
  );
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
  revalidatePath("/requests");
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
  await resolveTimeOffRequest(
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
        payload: { requestId, status: parsed.data.status },
      },
    ]);
  }
  revalidatePath("/requests");
}
