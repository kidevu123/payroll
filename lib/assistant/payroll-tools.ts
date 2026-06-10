import type { Actor } from "@/lib/db/queries/employees";
import { getEmployee, listEmployees } from "@/lib/db/queries/employees";
import {
  getPeriodById,
  listPeriods,
  lockPeriod,
  unlockPeriod,
} from "@/lib/db/queries/pay-periods";
import type { PayPeriod } from "@/lib/db/schema";
import {
  createPunch,
  editPunch,
  listPunches,
  voidPunch,
} from "@/lib/db/queries/punches";
import { listPayslipsForPeriod } from "@/lib/db/queries/payslips";
import {
  getRunWithPeriod,
  listExceptions,
  listRuns,
} from "@/lib/db/queries/payroll-runs";
import {
  getInProgressPoll,
  getLastPoll,
  getLastSuccessfulPoll,
  listRecentPolls,
  reconcileOrphanedPolls,
} from "@/lib/db/queries/poll-history";
import { runWeeklyHallMonitorAudit } from "@/lib/hall-monitor/run-weekly-audit";
import {
  makeManualPollJobData,
  NGTECO_PUNCH_POLL_QUEUE,
  punchPollBackfillSendOptions,
  punchPollTodaySendOptions,
} from "@/lib/jobs/punch-poll-queue";
import {
  NGTECO_MANUAL_PUNCH_SYNC_QUEUE,
  type ManualPunchSyncJobData,
} from "@/lib/ngteco/manual-punch-sync";
import { getSetting } from "@/lib/settings/runtime";
import { wallClockToUtc } from "@/lib/time/wall-clock";
import { toolFailure, toolResult } from "./serialize";

async function queueNgtecoPunchSync(
  punchId: string,
  actor: Actor,
): Promise<void> {
  try {
    const { getBoss } = await import("@/lib/jobs");
    const boss = await getBoss();
    await boss.send(NGTECO_MANUAL_PUNCH_SYNC_QUEUE, {
      punchId,
      actorId: actor.id,
      actorRole: actor.role,
    } satisfies ManualPunchSyncJobData);
  } catch {
    /* best-effort */
  }
}

function parseWall(
  raw: string,
  tz: string,
): { ok: true; date: Date } | { ok: false; error: string } {
  const wall = raw.replace(/([+-]\d{2}:?\d{2}|Z)$/i, "");
  const date = wallClockToUtc(wall, tz);
  if (!date) return { ok: false, error: `Invalid datetime: ${raw}` };
  return { ok: true, date };
}

/** Anthropic Messages API tool definitions. */
export const PAYROLL_ASSISTANT_TOOLS = [
  {
    name: "payroll_list_employees",
    description:
      "List payroll employees. Filter by status, search name, or pay schedule.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["ACTIVE", "INACTIVE", "TERMINATED"] },
        search: { type: "string" },
        payScheduleId: { type: "string", description: "Pay schedule UUID" },
      },
    },
  },
  {
    name: "payroll_get_employee",
    description: "Fetch one employee by UUID.",
    input_schema: {
      type: "object" as const,
      properties: {
        employeeId: { type: "string" },
      },
      required: ["employeeId"],
    },
  },
  {
    name: "payroll_list_periods",
    description: "List pay periods, optionally filtered by state.",
    input_schema: {
      type: "object" as const,
      properties: {
        state: { type: "string", enum: ["OPEN", "LOCKED", "PAID"] },
        limit: { type: "number", description: "Max rows (default 30)" },
      },
    },
  },
  {
    name: "payroll_get_period",
    description: "Fetch one pay period by UUID.",
    input_schema: {
      type: "object" as const,
      properties: { periodId: { type: "string" } },
      required: ["periodId"],
    },
  },
  {
    name: "payroll_lock_period",
    description: "Lock an OPEN pay period so punches cannot be edited.",
    input_schema: {
      type: "object" as const,
      properties: { periodId: { type: "string" } },
      required: ["periodId"],
    },
  },
  {
    name: "payroll_unlock_period",
    description: "Re-open a LOCKED pay period for punch edits.",
    input_schema: {
      type: "object" as const,
      properties: {
        periodId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["periodId", "reason"],
    },
  },
  {
    name: "payroll_list_punches",
    description:
      "List time punches by period, employee, or clock-in date range.",
    input_schema: {
      type: "object" as const,
      properties: {
        periodId: { type: "string" },
        employeeId: { type: "string" },
        clockAfter: { type: "string", description: "ISO datetime lower bound" },
        clockBefore: { type: "string", description: "ISO datetime upper bound" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "payroll_create_punch",
    description:
      "Add a manual admin punch. Optionally sync mend rows to NGTeco.",
    input_schema: {
      type: "object" as const,
      properties: {
        employeeId: { type: "string" },
        periodId: { type: "string" },
        clockIn: { type: "string" },
        clockOut: { type: "string" },
        notes: { type: "string" },
        syncToNgteco: { type: "boolean" },
      },
      required: ["employeeId", "periodId", "clockIn"],
    },
  },
  {
    name: "payroll_edit_punch",
    description: "Edit clock times on a punch.",
    input_schema: {
      type: "object" as const,
      properties: {
        punchId: { type: "string" },
        clockIn: { type: "string" },
        clockOut: { type: "string" },
        notes: { type: "string" },
        reason: { type: "string" },
        syncToNgteco: { type: "boolean" },
      },
      required: ["punchId", "reason"],
    },
  },
  {
    name: "payroll_void_punch",
    description: "Soft-void a punch with a required reason.",
    input_schema: {
      type: "object" as const,
      properties: {
        punchId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["punchId", "reason"],
    },
  },
  {
    name: "payroll_list_runs",
    description: "List recent payroll runs.",
    input_schema: {
      type: "object" as const,
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "payroll_get_run",
    description: "Fetch a payroll run with its pay period.",
    input_schema: {
      type: "object" as const,
      properties: { runId: { type: "string" } },
      required: ["runId"],
    },
  },
  {
    name: "payroll_list_run_exceptions",
    description: "List NGTeco ingest exceptions for a payroll run.",
    input_schema: {
      type: "object" as const,
      properties: { runId: { type: "string" } },
      required: ["runId"],
    },
  },
  {
    name: "payroll_list_payslips",
    description: "List payslips for a pay period.",
    input_schema: {
      type: "object" as const,
      properties: { periodId: { type: "string" } },
      required: ["periodId"],
    },
  },
  {
    name: "payroll_poll_status",
    description: "NGTeco punch poll status and recent history.",
    input_schema: {
      type: "object" as const,
      properties: { recentLimit: { type: "number" } },
    },
  },
  {
    name: "payroll_poll_now",
    description: "Queue a today-only NGTeco punch poll (~2–5 min).",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "payroll_poll_backfill",
    description: "Queue multi-day NGTeco punch backfill (1–30 days).",
    input_schema: {
      type: "object" as const,
      properties: { daysBack: { type: "number" } },
      required: ["daysBack"],
    },
  },
  {
    name: "payroll_run_hall_monitor",
    description: "Run the weekly hall-monitor payroll audit now.",
    input_schema: { type: "object" as const, properties: {} },
  },
];

export async function executePayrollTool(
  name: string,
  input: Record<string, unknown>,
  actor: Actor,
): Promise<string> {
  try {
    switch (name) {
      case "payroll_list_employees": {
        const rows = await listEmployees({
          ...(typeof input.status === "string"
            ? { status: input.status as "ACTIVE" | "INACTIVE" | "TERMINATED" }
            : {}),
          ...(typeof input.search === "string"
            ? { search: input.search }
            : {}),
          ...(typeof input.payScheduleId === "string"
            ? { payScheduleId: input.payScheduleId }
            : {}),
        });
        return toolResult({ count: rows.length, employees: rows });
      }
      case "payroll_get_employee": {
        const employeeId = String(input.employeeId ?? "");
        const employee = await getEmployee(employeeId);
        if (!employee) return toolFailure(`Employee not found: ${employeeId}`);
        return toolResult({ employee });
      }
      case "payroll_list_periods": {
        const limit = typeof input.limit === "number" ? input.limit : 30;
        const periods = await listPeriods({ limit });
        const filtered =
          typeof input.state === "string"
            ? periods.filter((p: PayPeriod) => p.state === input.state)
            : periods;
        return toolResult({ count: filtered.length, periods: filtered });
      }
      case "payroll_get_period": {
        const period = await getPeriodById(String(input.periodId ?? ""));
        if (!period) return toolFailure(`Period not found: ${input.periodId}`);
        return toolResult({ period });
      }
      case "payroll_lock_period": {
        const period = await lockPeriod(String(input.periodId ?? ""), actor);
        return toolResult({ ok: true, period });
      }
      case "payroll_unlock_period": {
        const period = await unlockPeriod(
          String(input.periodId ?? ""),
          String(input.reason ?? ""),
          actor,
        );
        return toolResult({ ok: true, period });
      }
      case "payroll_list_punches": {
        const limit = typeof input.limit === "number" ? input.limit : 100;
        const punches = await listPunches({
          ...(typeof input.periodId === "string"
            ? { periodId: input.periodId }
            : {}),
          ...(typeof input.employeeId === "string"
            ? { employeeId: input.employeeId }
            : {}),
          ...(typeof input.clockAfter === "string"
            ? { clockAfter: new Date(input.clockAfter) }
            : {}),
          ...(typeof input.clockBefore === "string"
            ? { clockBefore: new Date(input.clockBefore) }
            : {}),
        });
        return toolResult({
          count: punches.length,
          punches: punches.slice(0, limit),
        });
      }
      case "payroll_create_punch": {
        const company = await getSetting("company");
        const clockInParsed = parseWall(String(input.clockIn ?? ""), company.timezone);
        if (!clockInParsed.ok) return toolFailure(clockInParsed.error);
        let clockOut: Date | null = null;
        if (input.clockOut) {
          const out = parseWall(String(input.clockOut), company.timezone);
          if (!out.ok) return toolFailure(out.error);
          clockOut = out.date;
        }
        const punch = await createPunch(
          {
            employeeId: String(input.employeeId ?? ""),
            periodId: String(input.periodId ?? ""),
            clockIn: clockInParsed.date,
            clockOut,
            source: "MANUAL_ADMIN",
            notes: typeof input.notes === "string" ? input.notes : null,
          },
          actor,
        );
        const syncToNgteco = input.syncToNgteco !== false;
        if (syncToNgteco) await queueNgtecoPunchSync(punch.id, actor);
        return toolResult({ ok: true, punch, ngtecoSyncQueued: syncToNgteco });
      }
      case "payroll_edit_punch": {
        const company = await getSetting("company");
        const patch: {
          clockIn?: Date;
          clockOut?: Date | null;
          notes?: string | null;
        } = {};
        if (input.clockIn) {
          const parsed = parseWall(String(input.clockIn), company.timezone);
          if (!parsed.ok) return toolFailure(parsed.error);
          patch.clockIn = parsed.date;
        }
        if (input.clockOut !== undefined) {
          if (input.clockOut === null || input.clockOut === "") {
            patch.clockOut = null;
          } else {
            const parsed = parseWall(String(input.clockOut), company.timezone);
            if (!parsed.ok) return toolFailure(parsed.error);
            patch.clockOut = parsed.date;
          }
        }
        if (input.notes !== undefined) {
          patch.notes = typeof input.notes === "string" ? input.notes : null;
        }
        const punch = await editPunch(
          String(input.punchId ?? ""),
          patch,
          String(input.reason ?? ""),
          actor,
        );
        const syncToNgteco = input.syncToNgteco !== false;
        if (syncToNgteco) await queueNgtecoPunchSync(punch.id, actor);
        return toolResult({ ok: true, punch, ngtecoSyncQueued: syncToNgteco });
      }
      case "payroll_void_punch": {
        const punch = await voidPunch(
          String(input.punchId ?? ""),
          String(input.reason ?? ""),
          actor,
        );
        return toolResult({ ok: true, punch });
      }
      case "payroll_list_runs": {
        const limit = typeof input.limit === "number" ? input.limit : 30;
        const runs = await listRuns(limit);
        return toolResult({ count: runs.length, runs });
      }
      case "payroll_get_run": {
        const run = await getRunWithPeriod(String(input.runId ?? ""));
        if (!run) return toolFailure(`Run not found: ${input.runId}`);
        return toolResult({ run });
      }
      case "payroll_list_run_exceptions": {
        const exceptions = await listExceptions(String(input.runId ?? ""));
        return toolResult({ count: exceptions.length, exceptions });
      }
      case "payroll_list_payslips": {
        const payslips = await listPayslipsForPeriod(
          String(input.periodId ?? ""),
        );
        return toolResult({ count: payslips.length, payslips });
      }
      case "payroll_poll_status": {
        const recentLimit =
          typeof input.recentLimit === "number" ? input.recentLimit : 10;
        const reconciled = await reconcileOrphanedPolls();
        const [inProgress, last, lastOk, recent] = await Promise.all([
          getInProgressPoll(),
          getLastPoll(),
          getLastSuccessfulPoll(),
          listRecentPolls(recentLimit),
        ]);
        return toolResult({
          reconciledOrphans: reconciled,
          inProgress,
          last,
          lastSuccessful: lastOk,
          recent,
        });
      }
      case "payroll_poll_now": {
        await reconcileOrphanedPolls();
        if (await getInProgressPoll()) {
          return toolFailure("A poll is already running.");
        }
        const { getBoss } = await import("@/lib/jobs");
        const boss = await getBoss();
        const jobId = await boss.send(
          NGTECO_PUNCH_POLL_QUEUE,
          makeManualPollJobData(actor.id),
          punchPollTodaySendOptions,
        );
        if (!jobId) return toolFailure("Poll could not be queued.");
        return toolResult({ ok: true, queued: true, jobId });
      }
      case "payroll_poll_backfill": {
        const daysBack = Number(input.daysBack);
        if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 30) {
          return toolFailure("daysBack must be 1–30.");
        }
        await reconcileOrphanedPolls();
        if (await getInProgressPoll()) {
          return toolFailure("A poll is already running.");
        }
        const { getBoss } = await import("@/lib/jobs");
        const boss = await getBoss();
        const jobId = await boss.send(
          NGTECO_PUNCH_POLL_QUEUE,
          makeManualPollJobData(actor.id, { daysBack }),
          punchPollBackfillSendOptions,
        );
        if (!jobId) return toolFailure("Backfill could not be queued.");
        return toolResult({ ok: true, queued: true, jobId, daysBack });
      }
      case "payroll_run_hall_monitor": {
        const report = await runWeeklyHallMonitorAudit();
        return toolResult({ report });
      }
      default:
        return toolFailure(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return toolFailure(err instanceof Error ? err.message : String(err));
  }
}
