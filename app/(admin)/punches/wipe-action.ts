"use server";

import { z } from "zod";
import { and, gte, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { punches } from "@/lib/db/schema";
import { requireOwner } from "@/lib/auth-guards";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";

const schema = z.object({
  /** Soft-delete every non-voided punch with clock_in on or after this date. */
  fromDate: z.string().date(),
  /** Two-step confirm — must equal "wipe punches" exactly. */
  confirm: z.string(),
});

/**
 * Owner-only bulk soft-delete (void) of punches by clock_in date.
 * Per spec: nothing leaves the database. We set voided_at on every
 * affected row so computePay/payslip-recompute ignores them but the
 * row history is recoverable. Audited.
 */
export async function wipePunchesAfterAction(
  formData: FormData,
): Promise<
  | { ok: true; voided: number; fromDate: string }
  | { error: string }
> {
  const session = await requireOwner();
  const parsed = schema.safeParse({
    fromDate: formData.get("fromDate"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  if (parsed.data.confirm.trim() !== "wipe punches") {
    return { error: "Type 'wipe punches' to confirm." };
  }

  // Count what's about to be voided so we can audit + show the user.
  const preCount = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n
        FROM punches
        WHERE clock_in >= ${parsed.data.fromDate}
          AND voided_at IS NULL`,
  );
  const willVoid = preCount[0]?.n ?? 0;

  if (willVoid === 0) {
    return {
      error: `No active punches with clock_in on or after ${parsed.data.fromDate}.`,
    };
  }

  const voidedRows = await db
    .update(punches)
    .set({
      voidedAt: new Date(),
      editReason: sql`COALESCE(${punches.editReason}, '') || ${' [bulk-void from /punches/wipe; date >= ' + parsed.data.fromDate + ']'}`,
    })
    .where(
      and(
        gte(punches.clockIn, new Date(`${parsed.data.fromDate}T00:00:00Z`)),
        isNull(punches.voidedAt),
      ),
    )
    .returning({ id: punches.id });

  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "punch.bulk_void",
    targetType: "System",
    targetId: "punches",
    after: {
      fromDate: parsed.data.fromDate,
      voidedCount: voidedRows.length,
    },
  });

  logger.warn(
    {
      actor: session.user.id,
      fromDate: parsed.data.fromDate,
      voided: voidedRows.length,
    },
    "punch.bulk_void: rows soft-deleted",
  );

  // Invalidate everywhere a stale row total could land.
  revalidatePath("/time");
  revalidatePath("/payroll");
  revalidatePath("/reports");
  revalidatePath("/dashboard");

  return { ok: true, voided: voidedRows.length, fromDate: parsed.data.fromDate };
}
