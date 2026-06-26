import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import {
  buildAdminReportArtifacts,
  buildPayslipCutSheet,
} from "@/lib/pdf/build-admin-report";
import {
  buildCashDenominationSummary,
  type CashDenominationInput,
} from "@/lib/payroll/cash-denominations";
import { toolError, toolJson } from "../util.js";

function cashInputsFromAdminReport(
  input: Awaited<ReturnType<typeof buildAdminReportArtifacts>>["input"],
): CashDenominationInput[] {
  return input.employees
    .map((employee) => ({
      employeeId:
        employee.legacyId?.trim() ||
        employee.displayName.trim() ||
        "unknown",
      employeeName: employee.displayName,
      roundedPayCents: employee.totals.roundedCents,
    }))
    .filter((row) => row.roundedPayCents > 0)
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

export function registerPeriodPrintReportTools(server: McpServer): void {
  server.registerTool(
    "payroll_download_period_cut_sheet",
    {
      title: "Download period pay-slip cut sheet",
      description:
        "Build and return the pay-slip cut sheet PDF for a pay period " +
        "(same PDF as Payroll → Pay-slip cut sheet).",
      inputSchema: {
        periodId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ periodId }) => {
      try {
        const period = await getPeriodById(periodId);
        if (!period) return toolError(`Period not found: ${periodId}`);

        const { pdfBytes, filename } = await buildPayslipCutSheet(periodId);

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

  server.registerTool(
    "payroll_get_period_bank_cash_list",
    {
      title: "Get period bank cash list",
      description:
        "Return the bank cash denomination breakdown for a pay period " +
        "(same data as Payroll → Bank cash list).",
      inputSchema: {
        periodId: z.string().uuid(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ periodId }) => {
      try {
        const period = await getPeriodById(periodId);
        if (!period) return toolError(`Period not found: ${periodId}`);

        const { input } = await buildAdminReportArtifacts(periodId);
        const summary = buildCashDenominationSummary(
          cashInputsFromAdminReport(input),
        );

        return toolJson({
          periodId,
          startDate: period.startDate,
          endDate: period.endDate,
          state: period.state,
          summary,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
