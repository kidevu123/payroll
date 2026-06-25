import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { buildAdminReportArtifacts } from "@/lib/pdf/build-admin-report";
import { toolError, toolJson } from "../util.js";

export function registerSignatureReportTools(server: McpServer): void {
  server.registerTool(
    "payroll_download_period_signature",
    {
      title: "Download period signature report",
      description:
        "Build and return the admin signature report PDF for a pay period " +
        "(same PDF as Payroll → Signature report). Used when emailing the accountant.",
      inputSchema: {
        periodId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ periodId }) => {
      try {
        const period = await getPeriodById(periodId);
        if (!period) return toolError(`Period not found: ${periodId}`);

        const { pdfBytes, filename } =
          await buildAdminReportArtifacts(periodId);

        return toolJson({
          periodId,
          filename,
          pdfBase64: Buffer.from(pdfBytes).toString("base64"),
          startDate: period.startDate,
          endDate: period.endDate,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
