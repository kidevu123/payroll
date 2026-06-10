/** Human-readable catalog — mirrors MCP tools (payroll-mcp-server). */

export type CapabilityGroup = {
  title: string;
  items: { name: string; description: string; mutates?: boolean }[];
};

export const PAYROLL_ASSISTANT_CAPABILITIES: CapabilityGroup[] = [
  {
    title: "Employees",
    items: [
      {
        name: "payroll_list_employees",
        description:
          "List employees by status, name search, or pay schedule.",
      },
      {
        name: "payroll_get_employee",
        description: "Fetch one employee record by UUID.",
      },
    ],
  },
  {
    title: "Pay periods",
    items: [
      {
        name: "payroll_list_periods",
        description: "List pay periods (OPEN, LOCKED, PAID).",
      },
      {
        name: "payroll_get_period",
        description: "Fetch one pay period by UUID.",
      },
      {
        name: "payroll_lock_period",
        description: "Lock an OPEN period — blocks punch edits.",
        mutates: true,
      },
      {
        name: "payroll_unlock_period",
        description: "Re-open a LOCKED period (requires reason).",
        mutates: true,
      },
    ],
  },
  {
    title: "Time punches",
    items: [
      {
        name: "payroll_list_punches",
        description:
          "List punches by period, employee, or clock-in date range.",
      },
      {
        name: "payroll_create_punch",
        description:
          "Add a manual punch; optionally sync mend rows to NGTeco.",
        mutates: true,
      },
      {
        name: "payroll_edit_punch",
        description: "Edit clock times; reassigns period if needed.",
        mutates: true,
      },
      {
        name: "payroll_void_punch",
        description: "Soft-void a punch with a reason.",
        mutates: true,
      },
    ],
  },
  {
    title: "Payroll runs & payslips",
    items: [
      {
        name: "payroll_list_runs",
        description: "List recent payroll runs (ingest → publish).",
      },
      {
        name: "payroll_get_run",
        description: "Fetch a run with its pay period.",
      },
      {
        name: "payroll_list_run_exceptions",
        description: "NGTeco ingest exceptions for a run.",
      },
      {
        name: "payroll_list_payslips",
        description: "Payslips for a pay period.",
      },
    ],
  },
  {
    title: "NGTeco sync",
    items: [
      {
        name: "payroll_poll_status",
        description: "Poll health, in-progress job, recent history.",
      },
      {
        name: "payroll_poll_now",
        description: "Queue today-only punch poll (~2–5 min).",
        mutates: true,
      },
      {
        name: "payroll_poll_backfill",
        description: "Queue multi-day backfill (1–30 days).",
        mutates: true,
      },
    ],
  },
  {
    title: "Audits",
    items: [
      {
        name: "payroll_run_hall_monitor",
        description:
          "Weekly hall-monitor audit: open shifts, duplicates, poll health, etc.",
      },
    ],
  },
];
