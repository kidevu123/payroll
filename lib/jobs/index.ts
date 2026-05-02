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
      // Safety: archive completed jobs after a week so payroll history queries
      // are never racing with millions of dead rows.
      archiveCompletedAfterSeconds: 60 * 60 * 24 * 7,
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

  // pg-boss v10 removed implicit queue creation; create explicitly first.
  await boss.createQueue("noop.heartbeat");
  await boss.work("noop.heartbeat", async (jobs) => {
    logger.debug({ count: jobs.length }, "heartbeat tick");
  });
  if (cronEnabled) {
    await boss.schedule("noop.heartbeat", "* * * * *");
  } else {
    await boss.unschedule("noop.heartbeat").catch(() => undefined);
  }

  await boss.createQueue("period.rollover");
  await boss.work("period.rollover", async () => {
    await runPeriodRollover();
  });
  // 00:30 daily; the handler reads company timezone to decide what "today" is.
  if (cronEnabled) {
    await boss.schedule("period.rollover", "30 0 * * *");
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
    await boss.schedule("payroll.run.tick", automation.payrollRun.cron);
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

  // ── ngteco.punch.poll — per-punch realtime ingestion ──────────────────
  // Handler dynamically imported so its transitive dependencies (vault,
  // playwright scraper) don't enter the edge bundle for instrumentation.ts.
  await boss.createQueue("ngteco.punch.poll");
  await boss.work("ngteco.punch.poll", async () => {
    const auto = await getSetting("automation").catch(() => null);
    if (!auto?.ngtecoPunchPoll?.enabled) {
      logger.info("ngteco.punch.poll: disabled in settings; skipping");
      return;
    }
    const { runPollAndLog } = await import("./handlers/punch-poll-runner");
    await runPollAndLog({ triggeredBy: "CRON" });
  });
  if (cronEnabled && automation?.ngtecoPunchPoll?.enabled) {
    await boss.schedule(
      "ngteco.punch.poll",
      automation.ngtecoPunchPoll.cron ?? "*/15 * * * *",
    );
  } else {
    await boss.unschedule("ngteco.punch.poll").catch(() => undefined);
  }

  if (!cronEnabled) {
    logger.info("registerJobs: cronEnabled=false — all schedules skipped");
  }
}

