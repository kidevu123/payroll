// Next.js instrumentation hook. Runs once per worker on boot.
//
// Telemetry pipeline:
//   • Metrics: PrometheusExporter exposes a /metrics endpoint inside
//             the app process. The owner's existing Prometheus
//             collector scrapes it directly. Default port 9464; the
//             collector should target http://payroll:9464/metrics on
//             the docker network. Override with OTEL_PROMETHEUS_PORT.
//   • Traces: optional OTLP HTTP export to Tempo / Grafana Cloud.
//             Set OTEL_EXPORTER_OTLP_ENDPOINT to enable.
//   • Auto-instrumentation: HTTP + Postgres only (kept narrow so the
//             auto-instrumentations-node umbrella doesn't pull in
//             gcp-metadata / aws-lambda transitive deps that break
//             the webpack bundle).
//
// All env in /etc/payroll/.env on the LXC. Behavior is no-op when
// nothing's set so dev environments stay quiet.
//
//   OTEL_EXPORTER_OTLP_ENDPOINT          base URL for traces (optional)
//   OTEL_EXPORTER_OTLP_HEADERS           "Authorization=Basic ...,X-Scope-OrgID=..."
//   OTEL_PROMETHEUS_PORT                 metrics port (default 9464)
//   OTEL_PROMETHEUS_HOST                 bind host (default 0.0.0.0)
//   OTEL_SERVICE_NAME                    defaults to "payroll"
//   OTEL_DEPLOYMENT_ENVIRONMENT          defaults to NODE_ENV

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Local screenshot/preview runs: skip telemetry + pg-boss + the chromium
  // reaper, which would otherwise kill the Playwright browser used to verify
  // the UI. Set MILO_PREVIEW=1 only for local verification, never in prod.
  if (process.env.MILO_PREVIEW) return;

  // Hydrate BUILD_GIT_SHA from /app/.git-sha if the env var isn't set.
  // The Dockerfile's build stage stamps the SHA into that file; making
  // the gauge work is just a matter of reading it at boot.
  if (!process.env.BUILD_GIT_SHA) {
    try {
      const fs = await import("node:fs");
      const sha = fs.readFileSync("/app/.git-sha", "utf8").trim();
      if (sha) process.env.BUILD_GIT_SHA = sha;
    } catch {
      /* file missing in dev — fine */
    }
  }

  const exporterUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  const promPort = Number(process.env.OTEL_PROMETHEUS_PORT ?? 9464);
  const promHost = process.env.OTEL_PROMETHEUS_HOST ?? "0.0.0.0";

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { Resource } = await import("@opentelemetry/resources");

  const serviceName = process.env.OTEL_SERVICE_NAME ?? "payroll";
  const serviceVersion = process.env.npm_package_version ?? "0.0.0";

  const resource = new Resource({
    "service.name": serviceName,
    "service.version": serviceVersion,
    "deployment.environment":
      process.env.OTEL_DEPLOYMENT_ENVIRONMENT ?? process.env.NODE_ENV ?? "production",
  });

  // Prometheus scrape endpoint. Listens on a separate port (default
  // 9464) so it doesn't share the Next.js HTTP listener — keeps the
  // collector's scrape from being ratelimited by Next's middleware.
  const { PrometheusExporter } = await import(
    "@opentelemetry/exporter-prometheus"
  );
  const prometheusExporter = new PrometheusExporter({
    port: promPort,
    host: promHost,
    endpoint: "/metrics",
  });

  // Optional OTLP trace exporter. When unset, traces stay local.
  let traceExporter: import("@opentelemetry/sdk-trace-base").SpanExporter | undefined;
  if (exporterUrl) {
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    traceExporter = new OTLPTraceExporter({
      url: `${trimTrailingSlash(exporterUrl)}/v1/traces`,
      headers,
    });
  }

  // Narrow auto-instrumentation: HTTP server/client + Postgres.
  const { HttpInstrumentation } = await import(
    "@opentelemetry/instrumentation-http"
  );
  const { PgInstrumentation } = await import(
    "@opentelemetry/instrumentation-pg"
  );

  const sdkConfig = {
    resource,
    ...(traceExporter ? { traceExporter } : {}),
    metricReader: prometheusExporter,
    instrumentations: [
      new HttpInstrumentation({
        // Don't instrument the Prometheus scrape itself — the
        // collector hits /metrics every few seconds and the spans
        // would dominate the trace stream.
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? "";
          return url.startsWith("/metrics");
        },
        ignoreOutgoingRequestHook: (req) => {
          const host = req.host ?? "";
          return Boolean(exporterUrl && exporterUrl.includes(host));
        },
      }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
    ],
  };
  const sdk = new NodeSDK(
    sdkConfig as unknown as ConstructorParameters<typeof NodeSDK>[0],
  );
  sdk.start();

  // Eager-load lib/telemetry so its Counter priming + observable
  // gauge callbacks register IMMEDIATELY. Without this, the metrics
  // module would lazy-load on the first server-action call, leaving
  // /metrics empty until traffic hits — which is exactly what
  // populated the "no data" panels on a fresh deploy.
  await import("@/lib/telemetry");

  // Boot pg-boss after telemetry so its logs/spans are captured.
  const { getBoss } = await import("@/lib/jobs");
  await getBoss();
}

function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const [k, ...rest] = pair.split("=");
    if (!k || rest.length === 0) continue;
    out[k.trim()] = rest.join("=").trim();
  }
  return out;
}

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
