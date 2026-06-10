import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Actor } from "@/lib/db/queries/employees";
import {
  getInProgressPoll,
  getLastPoll,
  getLastSuccessfulPoll,
  listRecentPolls,
  reconcileOrphanedPolls,
} from "@/lib/db/queries/poll-history";
import {
  makeManualPollJobData,
  NGTECO_PUNCH_POLL_QUEUE,
  punchPollBackfillSendOptions,
  punchPollTodaySendOptions,
} from "@/lib/jobs/punch-poll-queue";
import { toolError, toolJson } from "../util.js";

export function registerNgtecoTools(server: McpServer, actor: Actor): void {
  server.registerTool(
    "payroll_poll_status",
    {
      title: "NGTeco poll status",
      description:
        "Current and recent NGTeco punch poll runs. Reconciles orphaned in-progress rows first.",
      inputSchema: {
        recentLimit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ recentLimit }) => {
      try {
        const reconciled = await reconcileOrphanedPolls();
        const [inProgress, last, lastOk, recent] = await Promise.all([
          getInProgressPoll(),
          getLastPoll(),
          getLastSuccessfulPoll(),
          listRecentPolls(recentLimit),
        ]);
        return toolJson({
          reconciledOrphans: reconciled,
          inProgress,
          last,
          lastSuccessful: lastOk,
          recent,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_poll_now",
    {
      title: "Poll NGTeco punches (today)",
      description:
        "Queue a today-only NGTeco punch poll (~2–5 min). Fails if a poll is already running.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async () => {
      try {
        await reconcileOrphanedPolls();
        const inProgress = await getInProgressPoll();
        if (inProgress) {
          return toolError(
            "A poll is already running. Check payroll_poll_status.",
          );
        }
        const { getBoss } = await import("@/lib/jobs");
        const boss = await getBoss();
        const jobId = await boss.send(
          NGTECO_PUNCH_POLL_QUEUE,
          makeManualPollJobData(actor.id),
          punchPollTodaySendOptions,
        );
        if (!jobId) return toolError("Poll could not be queued.");
        return toolJson({ ok: true, queued: true, jobId });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_poll_backfill",
    {
      title: "Backfill NGTeco punches",
      description:
        "Queue a multi-day NGTeco punch backfill (1–30 days). May take much longer than today-only.",
      inputSchema: {
        daysBack: z.number().int().min(1).max(30),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ daysBack }) => {
      try {
        await reconcileOrphanedPolls();
        const inProgress = await getInProgressPoll();
        if (inProgress) {
          return toolError(
            "A poll is already running. Wait for it to finish first.",
          );
        }
        const { getBoss } = await import("@/lib/jobs");
        const boss = await getBoss();
        const jobId = await boss.send(
          NGTECO_PUNCH_POLL_QUEUE,
          makeManualPollJobData(actor.id, { daysBack }),
          punchPollBackfillSendOptions,
        );
        if (!jobId) return toolError("Backfill poll could not be queued.");
        return toolJson({ ok: true, queued: true, jobId, daysBack });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
