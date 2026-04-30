// OpenTelemetry + structured logging.
//
// • OTel SDK boots in instrumentation.ts (Next.js's native hook).
// • This file exposes the bare minimum: a tracer for ad-hoc spans and a
//   structured logger for everything else.
// • Default exporter is the console; OTEL_EXPORTER_OTLP_ENDPOINT redirects
//   to the owner's Grafana stack (§19).

import { trace, type Tracer } from "@opentelemetry/api";

export function getTracer(name = "payroll"): Tracer {
  return trace.getTracer(name);
}

// Tiny structured logger. Pino is overkill for Phase 0; we just want JSON
// out of the box. Replace with Pino if/when needed.
export const logger = {
  debug: (...args: unknown[]) => log("debug", args),
  info: (...args: unknown[]) => log("info", args),
  warn: (...args: unknown[]) => log("warn", args),
  error: (...args: unknown[]) => log("error", args),
};

function log(level: "debug" | "info" | "warn" | "error", args: unknown[]) {
  const [first, second] = args;
  const msg =
    typeof first === "string"
      ? first
      : typeof second === "string"
        ? second
        : "";
  const ctx = typeof first === "object" && first !== null ? first : undefined;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx as object | undefined),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
