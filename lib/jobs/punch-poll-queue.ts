import type { PollOptions } from "@/lib/jobs/handlers/punch-poll";

export const NGTECO_PUNCH_POLL_QUEUE = "ngteco.punch.poll";

/** Playwright scrape + import can run ~70–90 min on auto-backfill. */
export const PUNCH_POLL_EXPIRE_SECONDS = 7_200;

export const punchPollSendOptions = {
  expireInSeconds: PUNCH_POLL_EXPIRE_SECONDS,
  singletonKey: "active",
} as const;

export const punchPollQueueOptions = {
  policy: "singleton" as const,
  expireInSeconds: PUNCH_POLL_EXPIRE_SECONDS,
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
    ...(pollOptions ? { pollOptions } : {}),
    force: true,
  };
}
