import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../.env") });

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
