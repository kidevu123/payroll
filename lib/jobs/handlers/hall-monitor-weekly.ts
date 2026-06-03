import { logger } from "@/lib/telemetry";
import { runWeeklyHallMonitorJob } from "@/lib/hall-monitor/run-weekly-audit";

/** Monday 6:00 AM ET — weekly outside verification for admins. */
export async function handleHallMonitorWeekly(): Promise<void> {
  const report = await runWeeklyHallMonitorJob();
  logger.info(
    {
      weekEnd: report.weekEnd,
      summary: report.summary,
      findingCount: report.findings.length,
    },
    "hall-monitor.weekly: done",
  );
}
