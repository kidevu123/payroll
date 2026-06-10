import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getEmployee,
  listEmployees,
} from "@/lib/db/queries/employees";
import { toolError, toolJson } from "../util.js";

export function registerEmployeeTools(server: McpServer): void {
  server.registerTool(
    "payroll_list_employees",
    {
      title: "List employees",
      description:
        "List payroll employees. Filter by status, search name, or pay schedule.",
      inputSchema: {
        status: z
          .enum(["ACTIVE", "INACTIVE", "TERMINATED"])
          .optional()
          .describe("Employment status filter"),
        search: z
          .string()
          .max(100)
          .optional()
          .describe("Case-insensitive name search"),
        payScheduleId: z
          .string()
          .uuid()
          .optional()
          .describe("Filter to a pay schedule UUID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      try {
        const rows = await listEmployees({
          ...(input.status ? { status: input.status } : {}),
          ...(input.search ? { search: input.search } : {}),
          ...(input.payScheduleId
            ? { payScheduleId: input.payScheduleId }
            : {}),
        });
        return toolJson({ count: rows.length, employees: rows });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "payroll_get_employee",
    {
      title: "Get employee",
      description: "Fetch one employee by UUID.",
      inputSchema: {
        employeeId: z.string().uuid().describe("Employee UUID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ employeeId }) => {
      try {
        const employee = await getEmployee(employeeId);
        if (!employee) return toolError(`Employee not found: ${employeeId}`);
        return toolJson({ employee });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
