#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  resolveMcpActorWithFallback,
  validateStartupEnv,
} from "./actor.js";
import { createPayrollMcpServer } from "./create-server.js";
import { runHttpServer } from "./http.js";

function parseMode(argv: string[]): "stdio" | "http" {
  if (argv.includes("--http")) return "http";
  return "stdio";
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  validateStartupEnv(mode);
  const actor = await resolveMcpActorWithFallback();

  if (mode === "http") {
    await runHttpServer(actor);
    return;
  }

  const server = createPayrollMcpServer(actor);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
