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
  /** Short headline (machine + legacy). */
  message: string;
  /** Plain-language card title (new reports). */
  title?: string;
  /** What this means for payroll. */
  meaning?: string;
  /** What the owner should do. */
  action?: string;
  bullets?: string[];
  href?: string;
  hrefLabel?: string;
  /** Optional structured detail for support / JSON export. */
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
