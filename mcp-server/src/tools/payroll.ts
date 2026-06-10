import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listPayslipsForPeriod } from "@/lib/db/queries/payslips";
import {
  getRunWithPeriod,
  listExceptions,
  listRuns,
} from "@/lib/db/queries/payroll-runs";
import { toolError, toolJson } from "../util.js";

export function registerPayrollTools(server: McpServer): void {
  server.registerTool(
    "payroll_list_runs",
    {
      title: "List payroll runs",
      description: "List recent payroll runs (ingest → publish pipeline).",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ limit }) => {
      try {
        const runs = await listRuns(limit);
        return toolJson({ count: runs.length, runs });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_get_run",
    {
      title: "Get payroll run",
      description: "Fetch a payroll run with its pay period.",
      inputSchema: {
        runId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ runId }) => {
      try {
        const run = await getRunWithPeriod(runId);
        if (!run) return toolError(`Run not found: ${runId}`);
        return toolJson({ run });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_list_run_exceptions",
    {
      title: "List run ingest exceptions",
      description: "List NGTeco ingest exceptions for a payroll run.",
      inputSchema: {
        runId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ runId }) => {
      try {
        const exceptions = await listExceptions(runId);
        return toolJson({ count: exceptions.length, exceptions });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_list_payslips",
    {
      title: "List payslips for period",
      description: "List payslips for a pay period.",
      inputSchema: {
        periodId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ periodId }) => {
      try {
        const payslips = await listPayslipsForPeriod(periodId);
        return toolJson({ count: payslips.length, payslips });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
