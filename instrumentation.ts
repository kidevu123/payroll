// Next.js instrumentation hook. This module runs once per worker on boot.
//
// • Starts the OTel Node SDK with a console exporter by default.
// • Boots pg-boss by importing the lazy initializer (idempotent).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import(
    "@opentelemetry/auto-instrumentations-node"
  );

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
    instrumentations: [getNodeAutoInstrumentations({
      // pg-boss is noisy under auto-instrumentation; keep it off.
      "@opentelemetry/instrumentation-pg": { enabled: true },
      "@opentelemetry/instrumentation-fs": { enabled: false },
    })],
    ...(traceExporter ? { traceExporter } : {}),
  });
  sdk.start();

  // Boot pg-boss after telemetry so its logs/spans are captured.
  const { getBoss } = await import("@/lib/jobs");
  await getBoss();
}
