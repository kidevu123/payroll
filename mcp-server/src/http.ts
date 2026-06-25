import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Actor } from "@/lib/db/queries/employees";
import { assertServiceToken, optionalEnv } from "./env.js";
import { createPayrollMcpServer } from "./create-server.js";

function bearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length).trim();
}

export async function runHttpServer(actor: Actor): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "15mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "payroll-mcp-server" });
  });

  app.post("/mcp", async (req, res) => {
    try {
      assertServiceToken(bearerToken(req.header("authorization")));
    } catch (err) {
      res.status(401).json({
        error: err instanceof Error ? err.message : "Unauthorized",
      });
      return;
    }

    const server = createPayrollMcpServer(actor);
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
    });

    try {
      await server.connect(transport as Parameters<typeof server.connect>[0]);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "MCP request failed",
        });
      }
    }
  });

  const port = Number(optionalEnv("MCP_HTTP_PORT") ?? "3100");
  const host = optionalEnv("MCP_HTTP_HOST") ?? "127.0.0.1";

  await new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      console.error(
        `payroll-mcp-server HTTP listening on http://${host}:${port}/mcp`,
      );
      resolve();
    });
  });
}
