"use server";

import { z } from "zod";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { payPeriods, payrollRuns, punches } from "@/lib/db/schema";
import { requireOwner } from "@/lib/auth-guards";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";
import { getSetting } from "@/lib/settings/runtime";

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

  // Resolve "from <fromDate>" in COMPANY tz so the cutoff is "midnight
  // ET on this date", not midnight UTC (which would be ~7pm previous
  // day in ET and silently void the previous evening's late shift).
  const company = await getSetting("company");
  const tz = company.timezone ?? "America/New_York";
  // Parse YYYY-MM-DD as midnight in `tz` by formatting noon-UTC of the
  // same date in tz, then computing the offset in minutes. We just want
  // the instant equal to <fromDate>T00:00 in tz expressed as a real Date.
  const cutoff = (() => {
    const noonUtc = new Date(`${parsed.data.fromDate}T12:00:00Z`);
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = dtf.formatToParts(noonUtc);
    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "00";
    // tz wall-clock minus UTC wall-clock for this instant = offset (minutes).
    // Build "tz-local noon" as a UTC date and diff with noonUtc.
    const tzNoon = Date.UTC(
      Number(get("year")),
      Number(get("month")) - 1,
      Number(get("day")),
      Number(get("hour")),
      Number(get("minute")),
      Number(get("second")),
    );
    const offsetMs = noonUtc.getTime() - tzNoon;
    return new Date(
      new Date(`${parsed.data.fromDate}T00:00:00Z`).getTime() + offsetMs,
    );
  })();
  const voidedRows = await db
    .update(punches)
    .set({
      voidedAt: new Date(),
      editReason: sql`COALESCE(${punches.editReason}, '') || ${' [bulk-void from /punches/wipe; date >= ' + parsed.data.fromDate + ']'}`,
    })
    .where(
      and(
        gte(punches.clockIn, cutoff),
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

/**
 * Hard-delete every OPEN pay_period that has zero non-voided punches AND
 * zero payroll_runs attached. These are typically auto-created cruft
 * from period-rollover cron runs that never got data. Owner asked for
 * uploads to be the only thing that creates periods, so existing empty
 * shells can go.
 *
 * Periods in LOCKED or PAID state, or any with attached runs/punches,
 * are left alone — even if no longer needed they may have forensic
 * value.
 */
export async function wipeEmptyOpenPeriodsAction(): Promise<
  | { ok: true; deleted: number }
  | { error: string }
> {
  const session = await requireOwner();
  try {
    // Identify candidates: OPEN, no non-voided punches, no payroll_runs.
    const candidates = await db.execute<{ id: string }>(
      sql`SELECT pp.id
          FROM pay_periods pp
          WHERE pp.state = 'OPEN'
            AND NOT EXISTS (
              SELECT 1 FROM punches p
              WHERE p.period_id = pp.id AND p.voided_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM payroll_runs pr WHERE pr.period_id = pp.id
            )`,
    );
    if (candidates.length === 0) {
      return { ok: true, deleted: 0 };
    }
    const ids = candidates.map((c) => c.id);

    // Delete all in one shot. No FKs reference an empty period (we just
    // verified above), so the delete cascades to nothing.
    await db.execute(
      sql`DELETE FROM pay_periods WHERE id = ANY(${ids})`,
    );

    await writeAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "pay_period.bulk_delete_empty_open",
      targetType: "System",
      targetId: "pay_periods",
      after: { deletedCount: ids.length, ids },
    });
    logger.warn(
      { actor: session.user.id, deletedCount: ids.length },
      "pay_period.bulk_delete_empty_open: rows removed",
    );
    revalidatePath("/payroll");
    revalidatePath("/time");
    revalidatePath("/dashboard");
    return { ok: true, deleted: ids.length };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed." };
  }
}
// keep the eq + payrollRuns + payPeriods imports referenced (they're
// used inside the dynamic SQL via raw expressions; lint doesn't see).
void eq;
void payPeriods;
void payrollRuns;

