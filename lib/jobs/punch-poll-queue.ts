import type { PollOptions } from "@/lib/jobs/handlers/punch-poll";

export const NGTECO_PUNCH_POLL_QUEUE = "ngteco.punch.poll";

/** Today-only manual poll — should finish in a few minutes. */
export const PUNCH_POLL_TODAY_EXPIRE_SECONDS = 900;

/** Explicit multi-day backfill — may take longer. */
export const PUNCH_POLL_BACKFILL_EXPIRE_SECONDS = 7_200;

export const punchPollTodaySendOptions = {
  expireInSeconds: PUNCH_POLL_TODAY_EXPIRE_SECONDS,
  singletonKey: "active",
} as const;

export const punchPollBackfillSendOptions = {
  expireInSeconds: PUNCH_POLL_BACKFILL_EXPIRE_SECONDS,
  singletonKey: "active",
} as const;

export const punchPollQueueOptions = {
  policy: "singleton" as const,
  expireInSeconds: PUNCH_POLL_BACKFILL_EXPIRE_SECONDS,
};

export type PunchPollJobData = {
  triggeredBy: "CRON" | "MANUAL";
  triggeredById?: string | null;
  pollOptions?: PollOptions;
  /**
   * Manual button clicks should always run. Scheduled ticks still respect
   * automation.ngtecoPunchPoll.enabled.
   */
  force?: boolean;
};

export function makeManualPollJobData(
  triggeredById: string,
  pollOptions?: PollOptions,
): PunchPollJobData {
  return {
    triggeredBy: "MANUAL",
    triggeredById,
    pollOptions: {
      daysBack: 0,
      skipAutoBackfill: true,
      ...(pollOptions ?? {}),
    },
    force: true,
  };
}
