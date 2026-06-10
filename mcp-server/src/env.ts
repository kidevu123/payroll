import { config } from "dotenv";
import { resolve } from "node:path";

// Local dev loads repo-root .env; production gets vars from Docker/env.
config({ path: resolve(process.cwd(), ".env") });

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the payroll MCP server.`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export function assertServiceToken(provided: string | undefined): void {
  const expected = requireEnv("MCP_SERVICE_TOKEN");
  if (!provided || provided !== expected) {
    throw new Error("Invalid or missing MCP service token.");
  }
}
