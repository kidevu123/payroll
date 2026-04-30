// Next.js instrumentation hook. This module runs once per worker on boot.
//
// • Starts the OTel Node SDK with a console exporter by default.
// • Boots pg-boss by importing the lazy initializer (idempotent).
//
// Auto-instrumentations are intentionally not loaded in Phase 0: the
// `@opentelemetry/auto-instrumentations-node` umbrella pulls in ~50
// instrumentation packages (AWS Lambda, MongoDB, GraphQL, gcp-metadata, …)
// whose transitive Node-built-in usage breaks webpack bundling. We add
// targeted instrumentations (http, pg) when the scraper lands in Phase 2+.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { NodeSDK } = await import("@opentelemetry/sdk-node");

  const exporterUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  let traceExporter: import("@opentelemetry/sdk-trace-base").SpanExporter | undefined;
  if (exporterUrl) {
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    traceExporter = new OTLPTraceExporter({ url: exporterUrl });
  }

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "payroll",
    ...(traceExporter ? { traceExporter } : {}),
  });
  sdk.start();

  // Boot pg-boss after telemetry so its logs/spans are captured.
  const { getBoss } = await import("@/lib/jobs");
  await getBoss();
}
