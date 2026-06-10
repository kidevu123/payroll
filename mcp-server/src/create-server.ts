import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Actor } from "@/lib/db/queries/employees";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerHallMonitorTools } from "./tools/hall-monitor.js";
import { registerNgtecoTools } from "./tools/ngteco.js";
import { registerPayrollTools } from "./tools/payroll.js";
import { registerPeriodTools } from "./tools/periods.js";
import { registerPunchTools } from "./tools/punches.js";

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

  return server;
}
