import type { PollOptions } from "@/lib/jobs/handlers/punch-poll";

export const NGTECO_PUNCH_POLL_QUEUE = "ngteco.punch.poll";

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
