// Append-only history of NGTeco punch polls. Both the scheduled cron and
// the manual "Poll Now" button log here. Surfaces "last poll: N min ago"
// and a short error trail in the admin UI.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  ngtecoPollLog,
  type NgtecoPollLogRow,
  type NewNgtecoPollLogRow,
} from "@/lib/db/schema";

export async function startPoll(
  init: Pick<NewNgtecoPollLogRow, "triggeredBy" | "triggeredById">,
): Promise<NgtecoPollLogRow> {
  const [row] = await db
    .insert(ngtecoPollLog)
    .values(init)
    .returning();
  if (!row) throw new Error("startPoll: insert returned no row");
  return row;
}

export async function finishPoll(
  id: string,
  result: {
    ok: boolean;
    eventsScraped?: number;
    pairsInserted?: number;
    pairsUpdated?: number;
    errorMessage?: string;
  },
): Promise<void> {
  await db
    .update(ngtecoPollLog)
    .set({
      finishedAt: new Date(),
      ok: result.ok,
      eventsScraped: result.eventsScraped ?? null,
      pairsInserted: result.pairsInserted ?? null,
      pairsUpdated: result.pairsUpdated ?? null,
      errorMessage: result.errorMessage ?? null,
    })
    // First terminal writer wins: if an admin cancel or hard-timeout already
    // finished this row, the worker's own finishPoll must not clobber that
    // status back to a stale ok/error.
    .where(and(eq(ngtecoPollLog.id, id), isNull(ngtecoPollLog.finishedAt)));
}

/** True when pg-boss still has an active worker on ngteco.punch.poll. */
export async function isPunchPollJobActive(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
    FROM pgboss.job
    WHERE name = 'ngteco.punch.poll'
      AND state = 'active'
    LIMIT 1
  `);
  return result.length > 0;
}

const ORPHAN_NO_WORKER_MS = 20 * 60 * 1000;
// The runner hard-kills a same-day poll at 10 min and a backfill at 30;
// anything older than this cannot still be doing work.
const ORPHAN_MAX_MS = 35 * 60 * 1000;

/**
 * Boot-time sweep: this is a single-node app, so at process start no poll
 * can be in flight. Any open row was orphaned by a restart (a deploy
 * mid-poll) — and pg-boss keeps that job "active" until its own expiry,
 * which made reconcileOrphanedPolls() think a worker was still alive and
 * left the banner on "running" for over an hour.
 */
export async function closePollsInterruptedByRestart(): Promise<number> {
  const open = await db
    .select({ id: ngtecoPollLog.id })
    .from(ngtecoPollLog)
    .where(isNull(ngtecoPollLog.finishedAt));
  for (const row of open) {
    await finishPoll(row.id, {
      ok: false,
      errorMessage:
        "Poll was interrupted by an app restart. Run Poll now again — today only takes under a minute.",
    });
  }
  // The pg-boss job the dead process was working is still "active" too.
  // The poll queue is a singleton, so until that row expires nothing else
  // on the queue can start — the hourly cron silently skips. Fail it now;
  // at process start no poll can be running.
  await db.execute(sql`
    UPDATE pgboss.job
    SET state = 'failed',
        completed_on = now(),
        output = '{"reason":"interrupted by app restart"}'::jsonb
    WHERE name = 'ngteco.punch.poll'
      AND state = 'active'
  `);
  return open.length;
}

/**
 * Close poll-log rows left open when pg-boss expired the job at 15 min
 * (old default) while Playwright kept running — or when the worker died.
 * Called before reading status so the UI does not show "running" forever.
 */
export async function reconcileOrphanedPolls(): Promise<number> {
  const open = await db
    .select()
    .from(ngtecoPollLog)
    .where(isNull(ngtecoPollLog.finishedAt))
    .orderBy(desc(ngtecoPollLog.startedAt));

  if (open.length === 0) return 0;

  const workerActive = await isPunchPollJobActive();
  const now = Date.now();
  let closed = 0;

  for (const row of open) {
    const elapsed = now - row.startedAt.getTime();
    const shouldClose =
      elapsed >= ORPHAN_MAX_MS ||
      (elapsed >= ORPHAN_NO_WORKER_MS && !workerActive);

    if (!shouldClose) continue;

    await finishPoll(row.id, {
      ok: false,
      errorMessage:
        elapsed >= ORPHAN_MAX_MS
          ? "Poll timed out after 100+ minutes. Try again or use Backfill missing days."
          : "Poll was interrupted (worker stopped). Try again — a fresh poll usually takes 1–5 min for today only.",
    });
    closed++;
  }

  return closed;
}

export async function getLastPoll(): Promise<NgtecoPollLogRow | null> {
  const [row] = await db
    .select()
    .from(ngtecoPollLog)
    .orderBy(desc(ngtecoPollLog.startedAt))
    .limit(1);
  return row ?? null;
}

/** Unfinished poll row, if any. Call reconcileOrphanedPolls() first. */
export async function getInProgressPoll(): Promise<NgtecoPollLogRow | null> {
  const [row] = await db
    .select()
    .from(ngtecoPollLog)
    .where(isNull(ngtecoPollLog.finishedAt))
    .orderBy(desc(ngtecoPollLog.startedAt))
    .limit(1);
  return row ?? null;
}

/** Most recent poll where ok=true. Drives auto-backfill: if this is
 *  more than a few hours old, the cron widens its window to include
 *  the gap days so the operator never has to click "Backfill". */
export async function getLastSuccessfulPoll(): Promise<NgtecoPollLogRow | null> {
  const [row] = await db
    .select()
    .from(ngtecoPollLog)
    .where(eq(ngtecoPollLog.ok, true))
    .orderBy(desc(ngtecoPollLog.startedAt))
    .limit(1);
  return row ?? null;
}

export async function listRecentPolls(limit = 20): Promise<NgtecoPollLogRow[]> {
  return db
    .select()
    .from(ngtecoPollLog)
    .orderBy(desc(ngtecoPollLog.startedAt))
    .limit(limit);
}

/**
 * Delete poll-log rows older than `days`. Called by punch-poll handler
 * after every successful run so the table doesn't grow unbounded
 * (15-min cron = ~35k rows/year). Default 90 days. Returns deleted count.
 */
export async function prunePollLog(days = 90): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(ngtecoPollLog)
    .where(sql`${ngtecoPollLog.startedAt} < ${cutoff.toISOString()}`)
    .returning({ id: ngtecoPollLog.id });
  return deleted.length;
}
