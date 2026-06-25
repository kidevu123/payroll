import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Actor } from "@/lib/db/queries/employees";
import {
  getPeriodById,
  listPeriods,
  lockPeriod,
  unlockPeriod,
} from "@/lib/db/queries/pay-periods";
import type { PayPeriod } from "@/lib/db/schema";
import { toolError, toolJson } from "../util.js";

export function registerPeriodTools(server: McpServer, actor: Actor): void {
  server.registerTool(
    "payroll_list_periods",
    {
      title: "List pay periods",
      description: "List pay periods, optionally filtered by state.",
      inputSchema: {
        state: z
          .enum(["OPEN", "LOCKED", "PAID"])
          .optional()
          .describe("Period state filter"),
        limit: z.number().int().min(1).max(100).default(30),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      try {
        const periods = await listPeriods({ limit: input.limit });
        const filtered = input.state
          ? periods.filter((p: PayPeriod) => p.state === input.state)
          : periods;
        return toolJson({
          count: filtered.length,
          periods: filtered,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_get_period",
    {
      title: "Get pay period",
      description: "Fetch one pay period by UUID.",
      inputSchema: {
        periodId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ periodId }) => {
      try {
        const period = await getPeriodById(periodId);
        if (!period) return toolError(`Period not found: ${periodId}`);
        return toolJson({ period });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_lock_period",
    {
      title: "Lock pay period",
      description:
        "Lock an OPEN pay period so punches can no longer be edited.",
      inputSchema: {
        periodId: z.string().uuid(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ periodId }) => {
      try {
        const period = await lockPeriod(periodId, actor);
        return toolJson({ ok: true, period });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_unlock_period",
    {
      title: "Unlock pay period",
      description: "Re-open a LOCKED pay period for punch edits.",
      inputSchema: {
        periodId: z.string().uuid(),
        reason: z.string().min(1).max(500),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ periodId, reason }) => {
      try {
        const period = await unlockPeriod(periodId, reason, actor);
        return toolJson({ ok: true, period });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_unmark_paid",
    {
      title: "Unmark pay period paid",
      description:
        "Demote a PAID period back to LOCKED so documents can be uploaded or removed.",
      inputSchema: {
        periodId: z.string().uuid(),
        reason: z.string().min(1).max(500),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ periodId, reason }) => {
      try {
        const { unmarkPaid } = await import("@/lib/db/queries/pay-periods");
        const period = await unmarkPaid(periodId, reason, actor);
        return toolJson({ ok: true, period });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_mark_paid",
    {
      title: "Mark pay period paid",
      description: "Mark a LOCKED pay period as PAID after payroll is complete.",
      inputSchema: {
        periodId: z.string().uuid(),
        paymentMethod: z.enum(["BANK", "CASH"]).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ periodId, paymentMethod }) => {
      try {
        const { markPaid } = await import("@/lib/db/queries/pay-periods");
        const period = await markPaid(
          periodId,
          actor,
          paymentMethod ? { paymentMethod } : {},
        );
        return toolJson({ ok: true, period });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
