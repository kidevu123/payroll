import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runWeeklyHallMonitorAudit } from "@/lib/hall-monitor/run-weekly-audit";
import { toolError, toolJson } from "../util.js";

export function registerHallMonitorTools(server: McpServer): void {
  server.registerTool(
    "payroll_run_hall_monitor",
    {
      title: "Run hall monitor audit",
      description:
        "Run the weekly hall-monitor audit now: poll health, open shifts, duplicate punches, period coverage, and more.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        const report = await runWeeklyHallMonitorAudit();
        return toolJson({ report });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
