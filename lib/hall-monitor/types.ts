/** Weekly outside-verifier report (hall monitor). */

export type HallMonitorSeverity = "ok" | "warn" | "fail";

export type HallMonitorFinding = {
  id: string;
  severity: HallMonitorSeverity;
  category:
    | "punch_integrity"
    | "coverage"
    | "pay_math"
    | "ngteco_sync"
    | "pending_work"
    | "roster";
  message: string;
  /** Optional structured detail for admin UI / JSON export. */
  detail?: Record<string, unknown>;
};

export type HallMonitorWeeklyReport = {
  generatedAt: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  summary: {
    ok: number;
    warn: number;
    fail: number;
  };
  findings: HallMonitorFinding[];
};
