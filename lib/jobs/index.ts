// pg-boss bootstrap. Postgres-backed job queue, no Redis.
//
// Jobs registered here:
//   • noop.heartbeat — sanity check, runs once per minute
//   • period.rollover — Phase 1 — daily 00:30 in company TZ
//   • ngteco.import — Phase 2 — manual + payroll-tick triggered scrape
//   • payroll.run.tick — Phase 2 — automation.payrollRun.cron orchestrator
//   • payroll.run.detect-exceptions — Phase 3 — runs after ingest
//   • payroll.run.fix-window-expire — Phase 3 — scheduled per-run
//   • payroll.run.publish — Phase 3 — admin approve → PDFs + notify
//   Phase 5 will add: notifications.dispatch

import type PgBoss from "pg-boss";
import { logger } from "@/lib/telemetry";
import { runPeriodRollover } from "./handlers/period-rollover";
import { handleNgtecoImport } from "./handlers/ngteco-import";
import { handlePayrollRunTick } from "./handlers/payroll-run-tick";
import { handleDetectExceptions } from "./handlers/detect-exceptions";
import { handleFixWindowExpire } from "./handlers/fix-window-expire";
import { handlePayrollRunPublish } from "./handlers/payroll-run-publish";
import { getSetting } from "@/lib/settings/runtime";
import {
  NGTECO_PUNCH_POLL_QUEUE,
  punchPollQueueOptions,
  type PunchPollJobData,
} from "./punch-poll-queue";
import { NGTECO_MANUAL_PUNCH_SYNC_QUEUE } from "@/lib/ngteco/manual-punch-sync";
import {
  handleZohoAdminReportBackup,
  ZOHO_ADMIN_REPORT_BACKUP_QUEUE,
  type ZohoAdminReportBackupJob,
} from "./handlers/zoho-admin-report-backup";

let bossPromise: Promise<PgBoss> | null = null;

/**
 * Lazily boot pg-boss against DATABASE_URL.
 *
 * Note: in dev, Next.js spawns multiple worker processes (and HMR reloads
 * server modules). We guard against double-bootstrap with module-scoped state.
 * In production (output: standalone), one process owns the queue.
 */
export function getBoss(): Promise<PgBoss> {
  if (bossPromise) return bossPromise;
  bossPromise = (async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set; pg-boss cannot start.");
    const { default: PgBoss } = await import("pg-boss");
    const boss = new PgBoss({
      connectionString: url,
      schema: "pgboss",
      // Retention: the pgboss.job table is internal plumbing, NOT payroll
      // history (that lives in payslips/runs). The old 7-day archive window
      // let completed rows pile up — with a per-minute heartbeat that's ~10k
      // dead rows, and the DB was mostly pg-boss job history. Archive completed
      // + failed jobs after 12h (pg-boss's own default) so the hot job table
      // stays tiny, and purge the archive after 2 days — enough to debug a
      // recent failure, short enough to stay lean. Maintenance auto-applies
      // this to the existing backlog on its next sweep.
      archiveCompletedAfterSeconds: 60 * 60 * 12,
      archiveFailedAfterSeconds: 60 * 60 * 12,
      deleteAfterDays: 2,
    });
    boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
    await boss.start();

    await registerJobs(boss);
    logger.info("pg-boss started");
    return boss;
  })();
  return bossPromise;
}

async function registerJobs(boss: PgBoss): Promise<void> {
  // Master kill switch — when automation.cronEnabled === false, every
  // cron schedule is skipped (and any stale ones get unscheduled). The
  // owner uses this for full-manual mode while reconciling data.
  const initialAuto = await getSetting("automation").catch(() => null);
  const cronEnabled = initialAuto?.cronEnabled ?? true;
  // Cron expressions are evaluated in the company timezone, not UTC.
  // Without this, "11:15 Mon-Sat" at the company in America/New_York
  // would fire at 11:15 UTC (= 7:15am ET in summer / 6:15am ET in
  // winter). pg-boss accepts an IANA tz on each schedule. Default to
  // America/New_York if the setting hasn't been configured yet.
  const company = await getSetting("company").catch(() => null);
  const tz = company?.timezone ?? "America/New_York";
  const tzOpts = { tz };

  // pg-boss v10 removed implicit queue creation; create explicitly first.
  await boss.createQueue("noop.heartbeat");
  await boss.work("noop.heartbeat", async (jobs) => {
    logger.debug({ count: jobs.length }, "heartbeat tick");
  });
  if (cronEnabled) {
    await boss.schedule("noop.heartbeat", "* * * * *", undefined, tzOpts);
  } else {
    await boss.unschedule("noop.heartbeat").catch(() => undefined);
  }

  await boss.createQueue("period.rollover");
  await boss.work("period.rollover", async () => {
    await runPeriodRollover();
  });
  // 00:30 daily; the handler reads company timezone to decide what "today" is.
  if (cronEnabled) {
    await boss.schedule("period.rollover", "30 0 * * *", undefined, tzOpts);
  } else {
    await boss.unschedule("period.rollover").catch(() => undefined);
  }

  // ── ngteco.import ──────────────────────────────────────────────────────
  await boss.createQueue("ngteco.import");
  await boss.work("ngteco.import", async (jobs) => {
    for (const j of jobs) {
      const data = j.data as { runId?: string };
      if (!data?.runId) {
        logger.error({ jobId: j.id }, "ngteco.import: missing runId");
        continue;
      }
      await handleNgtecoImport({ runId: data.runId });
    }
  });

  // ── payroll.run.tick — wired to automation.payrollRun.cron ─────────────
  await boss.createQueue("payroll.run.tick");
  await boss.work("payroll.run.tick", async () => {
    // Check the flag every fire — toggling enabled=false in /admin/settings
    // immediately stops the work even if pg-boss has a stale schedule.
    const auto = await getSetting("automation").catch(() => null);
    if (!auto?.payrollRun.enabled) {
      logger.info("payroll.run.tick: disabled in settings; skipping");
      return;
    }
    await handlePayrollRunTick(boss);
  });
  const automation = initialAuto;
  if (cronEnabled && automation?.payrollRun.enabled) {
    await boss.schedule(
      "payroll.run.tick",
      automation.payrollRun.cron,
      undefined,
      tzOpts,
    );
  } else {
    // Tear down any stale schedule from a prior boot when automation was on.
    await boss.unschedule("payroll.run.tick").catch(() => undefined);
  }

  // ── payroll.run.detect-exceptions ──────────────────────────────────────
  await boss.createQueue("payroll.run.detect-exceptions");
  await boss.work("payroll.run.detect-exceptions", async (jobs) => {
    for (const j of jobs) {
      const data = j.data as { runId?: string };
      if (!data?.runId) continue;
      await handleDetectExceptions({ runId: data.runId });
    }
  });

  // ── payroll.run.fix-window-expire (one-shot, scheduled per run) ────────
  await boss.createQueue("payroll.run.fix-window-expire");
  await boss.work("payroll.run.fix-window-expire", async (jobs) => {
    for (const j of jobs) {
      const data = j.data as { runId?: string };
      if (!data?.runId) continue;
      await handleFixWindowExpire({ runId: data.runId });
    }
  });

  // ── payroll.run.publish ────────────────────────────────────────────────
  await boss.createQueue("payroll.run.publish");
  await boss.work("payroll.run.publish", async (jobs) => {
    for (const j of jobs) {
      const data = j.data as { runId?: string };
      if (!data?.runId) continue;
      await handlePayrollRunPublish({ runId: data.runId });
    }
  });

  // ── zoho.admin-report.backup — upload admin report PDF to WorkDrive ────
  await boss.createQueue(ZOHO_ADMIN_REPORT_BACKUP_QUEUE);
  await boss.work(ZOHO_ADMIN_REPORT_BACKUP_QUEUE, async (jobs) => {
    for (const j of jobs) {
      const data = j.data as Partial<ZohoAdminReportBackupJob>;
      if (!data?.periodId) {
        logger.error(
          { jobId: j.id },
          "zoho.admin-report.backup: missing periodId",
        );
        continue;
      }
      await handleZohoAdminReportBackup({
        periodId: data.periodId,
        runId: data.runId ?? null,
      });
    }
  });

  // ── ngteco.punch.poll — per-punch realtime ingestion ──────────────────
  // Handler dynamically imported so its transitive dependencies (vault,
  // playwright scraper) don't enter the edge bundle for instrumentation.ts.
  // teamSize/teamConcurrency=1 enforces single-runner semantics: a long
  // scrape that overruns its 15-min cron tick won't get a sibling polling
  // the same NGTeco profile (Playwright would crash on the locked profile).
  await boss.createQueue(NGTECO_PUNCH_POLL_QUEUE, {
    name: NGTECO_PUNCH_POLL_QUEUE,
    ...punchPollQueueOptions,
  });
  try {
    await boss.updateQueue(NGTECO_PUNCH_POLL_QUEUE, {
      name: NGTECO_PUNCH_POLL_QUEUE,
      ...punchPollQueueOptions,
    });
  } catch {
    /* queue may not exist yet on first boot */
  }
  await boss.work(
    NGTECO_PUNCH_POLL_QUEUE,
    { teamSize: 1, teamConcurrency: 1 } as Parameters<typeof boss.work>[1],
    async (jobs) => {
      for (const j of jobs) {
        const data = (j.data ?? {}) as PunchPollJobData;
        const triggeredBy = data.triggeredBy ?? "CRON";
        const auto = await getSetting("automation").catch(() => null);
        if (!data.force && !auto?.ngtecoPunchPoll?.enabled) {
          logger.info("ngteco.punch.poll: disabled in settings; skipping");
          continue;
        }
        const { runPollAndLog } = await import("./handlers/punch-poll-runner");
        await runPollAndLog({
          triggeredBy,
          triggeredById: data.triggeredById ?? null,
          ...(data.pollOptions ? { pollOptions: data.pollOptions } : {}),
        });
      }
    },
  );
  if (cronEnabled && automation?.ngtecoPunchPoll?.enabled) {
    await boss.schedule(
      NGTECO_PUNCH_POLL_QUEUE,
      automation.ngtecoPunchPoll.cron ?? "0 * * * *",
      { triggeredBy: "CRON" } satisfies PunchPollJobData,
      tzOpts,
    );
  } else {
    await boss.unschedule(NGTECO_PUNCH_POLL_QUEUE).catch(() => undefined);
  }

  // ── ngteco.chrome-reaper — orphaned-browser backstop ───────────────────
  // pg-boss can abandon a poll (15-min expiry) without killing the headless
  // Chrome the handler spawned. The runner's hard timeout kills it in the
  // common case; this sweep is defense-in-depth. It only fires when NO poll
  // is active, so a legitimate in-flight (or long backfill) scrape is never
  // touched — any chrome alive while the queue is idle is by definition an
  // orphan from a job pg-boss already gave up on.
  await boss.createQueue("ngteco.chrome-reaper");
  await boss.work("ngteco.chrome-reaper", async () => {
    const { isPunchPollJobActive } = await import(
      "@/lib/db/queries/poll-history"
    );
    if (await isPunchPollJobActive()) return;
    const { killAllChromium } = await import("@/lib/ngteco/chromium-reaper");
    const killed = await killAllChromium();
    if (killed > 0) {
      logger.warn(
        { killed },
        "ngteco.chrome-reaper: reaped orphaned chrome with no active poll",
      );
    }
  });
  if (cronEnabled) {
    await boss.schedule("ngteco.chrome-reaper", "*/5 * * * *", undefined, tzOpts);
  } else {
    await boss.unschedule("ngteco.chrome-reaper").catch(() => undefined);
  }

  // ── ngteco.manual-punch.sync — Milo manual punch write-back ─────────────
  await boss.createQueue(NGTECO_MANUAL_PUNCH_SYNC_QUEUE);
  await boss.work(
    NGTECO_MANUAL_PUNCH_SYNC_QUEUE,
    { teamSize: 1, teamConcurrency: 1 } as Parameters<typeof boss.work>[1],
    async (jobs) => {
      const { handleManualPunchNgtecoSync } =
        await import("./handlers/manual-punch-ngteco-sync");
      for (const j of jobs) {
        const data = j.data as {
          punchId?: string;
          actorId?: string;
          actorRole?:
            | "OWNER"
            | "ADMIN"
            | "PAYROLL_STAFF"
            | "ACCOUNTANT"
            | "EMPLOYEE";
        };
        if (!data?.punchId || !data.actorId || !data.actorRole) {
          logger.error(
            { jobId: j.id },
            "ngteco.manual-punch.sync: missing payload",
          );
          continue;
        }
        await handleManualPunchNgtecoSync({
          punchId: data.punchId,
          actorId: data.actorId,
          actorRole: data.actorRole,
        });
      }
    },
  );

  // ── hall-monitor.weekly — outside verification (Monday 6am ET) ─────────
  await boss.createQueue("hall-monitor.weekly");
  await boss.work("hall-monitor.weekly", async () => {
    const { handleHallMonitorWeekly } = await import(
      "./handlers/hall-monitor-weekly"
    );
    await handleHallMonitorWeekly();
  });
  if (cronEnabled) {
    await boss.schedule("hall-monitor.weekly", "0 6 * * 1", undefined, tzOpts);
  } else {
    await boss.unschedule("hall-monitor.weekly").catch(() => undefined);
  }

  if (!cronEnabled) {
    logger.info("registerJobs: cronEnabled=false — all schedules skipped");
  }
}
