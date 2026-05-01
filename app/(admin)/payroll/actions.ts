"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import {
  lockPeriod,
  markPaid,
  unlockPeriod,
  unmarkPaid,
} from "@/lib/db/queries/pay-periods";
import { getLastPoll } from "@/lib/db/queries/poll-history";
import type { PollSummary } from "@/lib/jobs/handlers/punch-poll";

const idSchema = z.string().uuid();

export async function lockPeriodAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  await lockPeriod(id, { id: session.user.id, role: session.user.role });
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
}

const unlockSchema = z.object({ reason: z.string().min(1).max(500) });

export async function unlockPeriodAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = unlockSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  await unlockPeriod(id, parsed.data.reason, {
    id: session.user.id,
    role: session.user.role,
  });
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
}

export async function markPaidAction(
  id: string,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  try {
    await markPaid(id, { id: session.user.id, role: session.user.role });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not mark paid." };
  }
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
}

const unmarkPaidSchema = z.object({ reason: z.string().min(1).max(500) });

export async function unmarkPaidAction(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  if (!idSchema.safeParse(id).success) return { error: "Invalid id." };
  const parsed = unmarkPaidSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { error: "Reason required." };
  try {
    await unmarkPaid(id, parsed.data.reason, {
      id: session.user.id,
      role: session.user.role,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not unmark paid." };
  }
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
  revalidatePath("/reports");
}

export type PollNowResult =
  | { error: string }
  | { ok: true; summary: PollSummary };

/**
 * Manually trigger a punch.poll run. Blocks until the scrape + import
 * completes (typical ~30-60s) and returns a summary the UI can show.
 * Both cron + manual triggers funnel through runPollAndLog so the
 * ngteco_poll_log entry is consistent.
 */
export async function pollNowAction(): Promise<PollNowResult> {
  const session = await requireAdmin();
  // Dynamic import: the runner pulls Playwright + node:fs through the
  // poll handler chain. Top-level import would re-trigger the edge bundle
  // analyzer issue described in punch-poll.ts.
  const { runPollAndLog } = await import(
    "@/lib/jobs/handlers/punch-poll-runner"
  );
  try {
    const summary = await runPollAndLog({
      triggeredBy: "MANUAL",
      triggeredById: session.user.id,
    });
    revalidatePath("/payroll");
    revalidatePath("/time");
    return { ok: true, summary };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Poll failed.",
    };
  }
}

export async function getLastPollAction(): Promise<{
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean;
  triggeredBy: string;
  pairsInserted: number | null;
  pairsUpdated: number | null;
  errorMessage: string | null;
} | null> {
  await requireAdmin();
  const last = await getLastPoll();
  if (!last) return null;
  return {
    startedAt: last.startedAt.toISOString(),
    finishedAt: last.finishedAt?.toISOString() ?? null,
    ok: last.ok,
    triggeredBy: last.triggeredBy,
    pairsInserted: last.pairsInserted,
    pairsUpdated: last.pairsUpdated,
    errorMessage: last.errorMessage,
  };
}
