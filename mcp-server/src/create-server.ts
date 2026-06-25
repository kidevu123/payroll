import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Actor } from "@/lib/db/queries/employees";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerHallMonitorTools } from "./tools/hall-monitor.js";
import { registerNgtecoTools } from "./tools/ngteco.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerPeriodTools } from "./tools/periods.js";
import { registerPunchTools } from "./tools/punches.js";
import { registerPeriodDocTools } from "./tools/period-docs.js";
import { registerPeriodDocDeleteTools } from "./tools/period-doc-delete.js";
import { registerSignatureReportTools } from "./tools/signature-report.js";
import { registerSalariedDocTools } from "./tools/salaried-docs.js";

export function createPayrollMcpServer(actor: Actor): McpServer {
  const server = new McpServer({
    name: "payroll-mcp-server",
    version: "0.1.0",
  });

  registerEmployeeTools(server);
  registerPeriodTools(server, actor);
  registerPunchTools(server, actor);
  registerPayrollTools(server);
  registerNgtecoTools(server, actor);
  registerHallMonitorTools(server);
  registerSalariedDocTools(server, actor);
  registerPeriodDocTools(server, actor);
  registerPeriodDocDeleteTools(server, actor);
  registerSignatureReportTools(server);

  return server;
}
