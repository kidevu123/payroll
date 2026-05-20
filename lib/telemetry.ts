// OpenTelemetry + structured logging.
//
// • OTel SDK boots in instrumentation.ts (Next.js's native hook).
// • This file exposes:
//     - getTracer() for ad-hoc spans
//     - metrics: counters and histograms for the flows that matter
//     - structured logger for everything else
// • Default exporter is the console; OTEL_EXPORTER_OTLP_ENDPOINT
//   redirects to the owner's Grafana stack.

import { metrics, trace, type Tracer } from "@opentelemetry/api";

export function getTracer(name = "payroll"): Tracer {
  return trace.getTracer(name);
}

const meter = metrics.getMeter("payroll");

// ─────────────────────────────────────────────────────────────────────────────
// Domain metrics. Names follow OTel conventions: snake_case, dot-separated
// namespaces. Each is created lazily so importing this module is cheap.
// ─────────────────────────────────────────────────────────────────────────────

/** Count of NGTeco poll runs, labeled with outcome. */
export const ngtecoPollRuns = meter.createCounter("ngteco.poll.runs", {
  description: "NGTeco punch-poll executions",
});

/** Histogram of NGTeco scrape durations in milliseconds. */
export const ngtecoScrapeDuration = meter.createHistogram(
  "ngteco.scrape.duration_ms",
  {
    description: "NGTeco scrape duration",
    unit: "ms",
  },
);

/** Count of punches imported from a poll/scrape. */
export const punchesImported = meter.createCounter("punches.imported", {
  description: "Number of punches inserted/updated by ingest",
});

/** Count of payroll runs published, labeled with schedule kind. */
export const payrollRunsPublished = meter.createCounter(
  "payroll.runs.published",
  {
    description: "Payroll runs that reached PUBLISHED state",
  },
);

/** Histogram of payroll publish duration in ms. */
export const payrollPublishDuration = meter.createHistogram(
  "payroll.publish.duration_ms",
  {
    description: "Time from publish-start to PUBLISHED state",
    unit: "ms",
  },
);

/** Count of payslips generated, labeled with run kind. */
export const payslipsGenerated = meter.createCounter("payslips.generated", {
  description: "Payslips written by the publish handler",
});

/** Count of pay periods marked PAID. */
export const periodsMarkedPaid = meter.createCounter("periods.marked_paid", {
  description: "Pay periods transitioned to PAID state",
});

/** Count of cron job firings (heartbeat for liveness). */
export const cronJobFires = meter.createCounter("cron.job.fires", {
  description: "pg-boss cron-driven job executions",
});

/** Count of structured-error log lines. Use this so Grafana alerts on
 *  rising error rates without parsing log text. */
export const errorEvents = meter.createCounter("app.errors", {
  description: "Errors emitted via logger.error()",
});

// ─────────────────────────────────────────────────────────────────────────────
// Usage metrics — "how many people are using the app" per Grafana.
// All counters/histograms; aggregate by role/surface in dashboards.
// ─────────────────────────────────────────────────────────────────────────────

/** One increment per successful sign-in. Labeled by role. */
export const authSignins = meter.createCounter("app.auth.signins", {
  description: "Successful sign-ins, labeled by role",
});

/** Active session ping — fired when an authenticated request hits the
 *  app shell. Use `count by (user_id)` over 5m to derive DAU/WAU. */
export const sessionPing = meter.createCounter("app.session.ping", {
  description: "Authenticated request seen — one per page render",
});

/** Server-action invocations. Label with the action name so Grafana
 *  can break down which features are used most. */
export const serverActionInvocations = meter.createCounter(
  "app.action.invocations",
  {
    description: "Server actions invoked, labeled by action name",
  },
);

/** Histogram of server-action durations in ms. Same labels as
 *  serverActionInvocations. */
export const serverActionDuration = meter.createHistogram(
  "app.action.duration_ms",
  {
    description: "Server-action wall-clock duration",
    unit: "ms",
  },
);

/** A page render. Labeled by surface (admin / employee / login). The
 *  per-route auto-instrumentation already tracks HTTP routes; this
 *  one is for high-level "how many active sessions" rollups. */
export const pageRenders = meter.createCounter("app.page.renders", {
  description: "Page renders by surface",
});

/** Notifications dispatched (in-app + push). Label by kind. */
export const notificationsSent = meter.createCounter(
  "app.notifications.sent",
  {
    description: "Notifications dispatched, labeled by channel + kind",
  },
);

// Prime each Counter so a `_total = 0` series shows up at /metrics
// before the first real event. The OTel SDK only emits Counter
// series after the first `.add()`, so without this Grafana panels
// would read "no data" on a fresh deploy until someone signs in.
ngtecoPollRuns.add(0, { outcome: "_init" });
punchesImported.add(0, { source: "_init" });
payrollRunsPublished.add(0, { kind: "_init" });
payslipsGenerated.add(0, { kind: "_init" });
periodsMarkedPaid.add(0, { kind: "_init" });
cronJobFires.add(0, { job: "_init" });
authSignins.add(0, { role: "_init" });
sessionPing.add(0, { role: "_init", surface: "_init" });
serverActionInvocations.add(0, { action: "_init" });
pageRenders.add(0, { surface: "_init" });
notificationsSent.add(0, { channel: "_init", kind: "_init" });
errorEvents.add(0, { source: "_init" });

// ─────────────────────────────────────────────────────────────────────────────
// Live-state gauges. Read the DB at every Prometheus scrape (~15s) and
// emit a fresh value. These always have data even on a fresh deploy —
// good for the "is the app being used" question without waiting for
// counters to tick. Failures are swallowed so a transient DB blip
// doesn't crash the meter callback.
// ─────────────────────────────────────────────────────────────────────────────
const employeesByStatus = meter.createObservableGauge(
  "app.employees.count",
  { description: "Employees by status" },
);
const usersActive24h = meter.createObservableGauge(
  "app.users.active_24h",
  { description: "Users with successful login in last 24h" },
);
const periodsByState = meter.createObservableGauge("app.periods.count", {
  description: "Pay periods by state",
});
const feedbackOpen = meter.createObservableGauge("app.feedback.open", {
  description: "Open (unresolved) feedback / bug reports",
});

employeesByStatus.addCallback(async (result) => {
  try {
    const { db } = await import("@/lib/db");
    const { employees } = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const rows = await db
      .select({ status: employees.status, n: sql<number>`count(*)::int` })
      .from(employees)
      .groupBy(employees.status);
    for (const r of rows) result.observe(Number(r.n), { status: r.status });
  } catch {
    /* DB unavailable — skip this scrape */
  }
});

usersActive24h.addCallback(async (result) => {
  try {
    const { db } = await import("@/lib/db");
    const { users } = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`${users.lastLoginAt} > now() - interval '24 hours'`);
    result.observe(Number(row?.n ?? 0));
  } catch {
    /* skip */
  }
});

periodsByState.addCallback(async (result) => {
  try {
    const { db } = await import("@/lib/db");
    const { payPeriods } = await import("@/lib/db/schema");
    const { sql } = await import("drizzle-orm");
    const rows = await db
      .select({ state: payPeriods.state, n: sql<number>`count(*)::int` })
      .from(payPeriods)
      .groupBy(payPeriods.state);
    for (const r of rows) result.observe(Number(r.n), { state: r.state });
  } catch {
    /* skip */
  }
});

feedbackOpen.addCallback(async (result) => {
  try {
    const { db } = await import("@/lib/db");
    const { appFeedback } = await import("@/lib/db/schema");
    const { sql, isNull } = await import("drizzle-orm");
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(appFeedback)
      .where(isNull(appFeedback.resolvedAt));
    result.observe(Number(row?.n ?? 0));
  } catch {
    /* skip */
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Build / deploy info. Single emission at boot — labels carry the SHA,
// version, and start time so Grafana can render a CI/CD section without
// scraping git or systemd. The systemd deploy unit writes the current SHA
// into BUILD_GIT_SHA at recreate time; locally it falls back to "dev".
// ─────────────────────────────────────────────────────────────────────────────
const buildInfo = meter.createObservableGauge("milo.build.info", {
  description: "Build/deploy info (1) with sha + version labels",
});
const startTime = meter.createObservableGauge("milo.process.start_time_seconds", {
  description: "Unix epoch seconds when this process started",
  unit: "s",
});
const PROCESS_START = Math.floor(Date.now() / 1000);
buildInfo.addCallback((result) => {
  result.observe(1, {
    sha: process.env.BUILD_GIT_SHA ?? "dev",
    version: process.env.npm_package_version ?? "0.0.0",
    branch: process.env.BUILD_GIT_BRANCH ?? "unknown",
  });
});
startTime.addCallback((result) => result.observe(PROCESS_START));

// ─────────────────────────────────────────────────────────────────────────────
// Structured JSON logger. Every error.* call also bumps the errorEvents
// metric so error rates are visible in Grafana without log parsing.
// ─────────────────────────────────────────────────────────────────────────────

export const logger = {
  debug: (...args: unknown[]) => log("debug", args),
  info: (...args: unknown[]) => log("info", args),
  warn: (...args: unknown[]) => log("warn", args),
  error: (...args: unknown[]) => {
    log("error", args);
    try {
      errorEvents.add(1, { source: errorSource(args) });
    } catch {
      /* metric SDK not initialized in some test paths */
    }
  },
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

function errorSource(args: unknown[]): string {
  const first = args[0];
  if (first && typeof first === "object" && "source" in first) {
    const s = (first as { source?: unknown }).source;
    if (typeof s === "string") return s;
  }
  return "app";
}
