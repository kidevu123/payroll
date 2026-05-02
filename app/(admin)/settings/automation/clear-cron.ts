"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth-guards";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";

/**
 * Owner-only nuke: deletes every row in pg-boss's `schedule` table and
 * cancels every pending/active queued job. Intended for the "I want full
 * manual mode and no cron entries to fire even once more" use case.
 *
 * Requires the master `automation.cronEnabled` flag to be off — otherwise
 * the next pg-boss tick will just re-create the schedules from
 * registerJobs(). The UI nags the owner to flip the flag first.
 */
export async function clearAllCronAction(): Promise<
  | { ok: true; schedulesDeleted: number; jobsCancelled: number }
  | { error: string }
> {
  const session = await requireOwner();
  try {
    // Delete every schedule row.
    const schedRes = await db.execute<{ relname: string }>(
      sql`DELETE FROM pgboss.schedule RETURNING name AS relname`,
    );
    const schedulesDeleted = schedRes.length;

    // Mark queued/active jobs as cancelled. pg-boss state values are:
    //   created | retry | active | completed | expired | cancelled | failed
    // We touch only the pre-completion ones — leaves history intact.
    const jobsRes = await db.execute<{ id: string }>(
      sql`UPDATE pgboss.job
          SET state = 'cancelled', completed_on = now()
          WHERE state IN ('created', 'retry', 'active')
          RETURNING id`,
    );
    const jobsCancelled = jobsRes.length;

    await writeAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "automation.clear_all_cron",
      targetType: "System",
      targetId: "pgboss",
      after: { schedulesDeleted, jobsCancelled },
    });
    logger.warn(
      { schedulesDeleted, jobsCancelled, actor: session.user.id },
      "automation.clear_all_cron: pg-boss cleared",
    );

    revalidatePath("/settings/automation");
    return { ok: true, schedulesDeleted, jobsCancelled };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to clear cron.",
    };
  }
}
