import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listDocs } from "@/lib/db/queries/payroll-documents";
import { listPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { toolError, toolJson } from "../util.js";

export function registerEmployeeReadTools(server: McpServer): void {
  server.registerTool(
    "payroll_list_employee_documents",
    {
      title: "List employee pay documents",
      description:
        "List uploaded accountant paystubs/W2s for an employee (newest first).",
      inputSchema: {
        employeeId: z.string().uuid(),
        kind: z.enum(["W2", "PAYSTUB", "OTHER"]).optional(),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ employeeId, kind, limit }) => {
      try {
        const docs = await listDocs({ employeeId });
        const filtered = docs
          .filter((doc) => (kind ? doc.kind === kind : true))
          .slice(0, limit)
          .map((doc) => ({
            id: doc.id,
            periodId: doc.periodId,
            employeeId: doc.employeeId,
            kind: doc.kind,
            originalFilename: doc.originalFilename,
            amountCents: doc.amountCents,
            payPeriodStart: doc.payPeriodStart,
            payPeriodEnd: doc.payPeriodEnd,
            uploadedAt: doc.uploadedAt?.toISOString?.() ?? doc.uploadedAt,
          }));
        return toolJson({ count: filtered.length, documents: filtered });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_list_employee_payslips",
    {
      title: "List employee Milo payslips",
      description:
        "List Milo-computed payslips for an employee across periods (newest first).",
      inputSchema: {
        employeeId: z.string().uuid(),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ employeeId, limit }) => {
      try {
        const payslips = (await listPayslipsForEmployee(employeeId))
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            periodId: row.periodId,
            employeeId: row.employeeId,
            grossPayCents: row.grossPayCents,
            roundedPayCents: row.roundedPayCents,
            hoursWorked: row.hoursWorked,
            generatedAt: row.generatedAt?.toISOString?.() ?? row.generatedAt,
          }));
        return toolJson({ count: payslips.length, payslips });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
