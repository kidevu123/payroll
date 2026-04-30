// pg-boss bootstrap. Postgres-backed job queue, no Redis.
//
// Jobs registered here:
//   • noop.heartbeat — sanity check, runs once per minute
//   • period.rollover — Phase 1 — daily 00:30 in company TZ
//   • ngteco.import — Phase 2 — manual + payroll-tick triggered scrape
//   • payroll.run.tick — Phase 2 — automation.payrollRun.cron orchestrator
//   Phase 3 will add: payroll.run.publish + payslip.generate
//   Phase 5 will add: notifications.dispatch

import type PgBoss from "pg-boss";
import { logger } from "@/lib/telemetry";
import { runPeriodRollover } from "./handlers/period-rollover";
import { handleNgtecoImport } from "./handlers/ngteco-import";
import { handlePayrollRunTick } from "./handlers/payroll-run-tick";
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
  // pg-boss v10 removed implicit queue creation; create explicitly first.
  await boss.createQueue("noop.heartbeat");
  await boss.work("noop.heartbeat", async (jobs) => {
    logger.debug({ count: jobs.length }, "heartbeat tick");
  });
  await boss.schedule("noop.heartbeat", "* * * * *");

  await boss.createQueue("period.rollover");
  await boss.work("period.rollover", async () => {
    await runPeriodRollover();
  });
  // 00:30 daily; the handler reads company timezone to decide what "today" is.
  await boss.schedule("period.rollover", "30 0 * * *");

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
    await handlePayrollRunTick(boss);
  });
  const automation = await getSetting("automation").catch(() => null);
  if (automation?.payrollRun.enabled) {
    await boss.schedule("payroll.run.tick", automation.payrollRun.cron);
  }
}
