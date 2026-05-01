// Append-only history of NGTeco punch polls. Both the scheduled cron and
// the manual "Poll Now" button log here. Surfaces "last poll: N min ago"
// and a short error trail in the admin UI.

import { desc, eq } from "drizzle-orm";
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
    .where(eq(ngtecoPollLog.id, id));
}

export async function getLastPoll(): Promise<NgtecoPollLogRow | null> {
  const [row] = await db
    .select()
    .from(ngtecoPollLog)
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
