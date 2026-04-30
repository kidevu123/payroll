// pg-boss bootstrap. Postgres-backed job queue, no Redis.
//
// Jobs registered here:
//   • noop.heartbeat — sanity check, runs once per minute
//   Phase 2 will add: ngteco.import
//   Phase 3 will add: payroll.run.* + payslip.generate
//   Phase 5 will add: notifications.dispatch

import type PgBoss from "pg-boss";
import { logger } from "@/lib/telemetry";

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
  // Heartbeat — validates the queue is alive end to end.
  await boss.work("noop.heartbeat", async (jobs) => {
    logger.debug({ count: jobs.length }, "heartbeat tick");
  });
  // Schedule the heartbeat once per minute. Idempotent — repeat calls just
  // overwrite the schedule.
  await boss.schedule("noop.heartbeat", "* * * * *");
}
