// Dashboard centerpiece — fills ~50% of viewport with a state-driven CTA.
// State sets the tone, the headline, the supporting line, and the single
// primary action. Secondary actions show as quieter links underneath.
//
// Visual contract (Phase 6.5):
//   • Active states get a subtle brand-accent treatment (gradient backdrop +
//     thicker brand border) so the eye lands here before reading copy.
//   • Numeric stats use JetBrains Mono and tabular-nums so columns align.
//   • A four-step state-machine bar shows where this run sits in its lifecycle.

import * as React from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Hourglass,
  PlayCircle,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "./money-display";
import { HoursDisplay } from "./hours-display";

type State =
  | "NO_RUN"
  | "SCHEDULED"
  | "INGESTING"
  | "INGEST_FAILED"
  | "AWAITING_EMPLOYEE_FIXES"
  | "AWAITING_ADMIN_REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELLED";

type Stats = {
  hours: number;
  gross: number;
  rounded: number;
  employeeCount: number;
  unresolvedAlerts: number;
};

export type PayrollRunCardProps = {
  state: State;
  period?: { startDate: string; endDate: string };
  runId?: string;
  stats?: Stats;
  fixDeadline?: string | null;
  hoursDecimalPlaces?: number;
};

type Tone = "neutral" | "info" | "warn" | "danger" | "success";

const COPY: Record<
  State,
  {
    headline: string;
    sub: string;
    Icon: React.ComponentType<{ className?: string }>;
    tone: Tone;
  }
> = {
  NO_RUN: {
    headline: "No payroll run yet",
    sub: "The next run starts on the configured cron, or you can trigger one manually.",
    Icon: Workflow,
    tone: "neutral",
  },
  SCHEDULED: {
    headline: "Run scheduled",
    sub: "The ingest will start at the next tick.",
    Icon: CalendarClock,
    tone: "info",
  },
  INGESTING: {
    headline: "Pulling punches from NGTeco",
    sub: "This usually takes under a minute. Watch /ngteco for live progress.",
    Icon: Workflow,
    tone: "info",
  },
  INGEST_FAILED: {
    headline: "Ingest failed",
    sub: "Retry or open the run for the captured screenshot.",
    Icon: CircleX,
    tone: "danger",
  },
  AWAITING_EMPLOYEE_FIXES: {
    headline: "Waiting on employee fixes",
    sub: "Missed-punch alerts went out. The fix window closes automatically — you can also advance to review now.",
    Icon: Hourglass,
    tone: "warn",
  },
  AWAITING_ADMIN_REVIEW: {
    headline: "Ready for review",
    sub: "Confirm hours and approve to publish payslips.",
    Icon: CircleAlert,
    tone: "warn",
  },
  APPROVED: {
    headline: "Approved — generating payslips",
    sub: "PDFs are landing. The run will flip to Published in a moment.",
    Icon: PlayCircle,
    tone: "info",
  },
  PUBLISHED: {
    headline: "Payroll published",
    sub: "Payslips delivered. The Sunday close is done.",
    Icon: CircleCheck,
    tone: "success",
  },
  FAILED: {
    headline: "Run failed mid-publish",
    sub: "Some payslips may have been written. Retry the publish step.",
    Icon: CircleX,
    tone: "danger",
  },
  CANCELLED: {
    headline: "Run cancelled",
    sub: "Start a new run when ready.",
    Icon: Clock,
    tone: "neutral",
  },
};

const TONE_ICON: Record<Tone, string> = {
  neutral: "text-text-muted bg-surface-2",
  info: "text-info-700 bg-info-50",
  warn: "text-warn-700 bg-warn-50",
  danger: "text-danger-700 bg-danger-50",
  success: "text-success-700 bg-success-50",
};

const ATTENTION_STATES = new Set<State>([
  "AWAITING_ADMIN_REVIEW",
  "INGEST_FAILED",
  "FAILED",
]);

export function PayrollRunCard(props: PayrollRunCardProps) {
  const c = COPY[props.state];
  const { Icon } = c;
  const attention = ATTENTION_STATES.has(props.state);
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-card bg-surface p-8 lg:p-10 min-h-[24rem] flex flex-col shadow-card",
        attention ? "border-2 border-brand-700" : "border border-border",
      )}
    >
      {attention ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(120% 80% at 100% 0%, var(--color-brand-50), transparent 60%)",
          }}
        />
      ) : null}

      <div className="relative flex items-start gap-4 mb-6">
        <span
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-card",
            TONE_ICON[c.tone],
          )}
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-display font-semibold tracking-tight leading-tight">
            {c.headline}
          </h2>
          <p className="text-sm text-text-muted mt-1.5 max-w-2xl leading-relaxed">
            {c.sub}
          </p>
          {props.period ? (
            <p className="text-xs text-text-muted mt-3">
              Period:{" "}
              <span className="font-mono tabular-nums">
                {props.period.startDate}
              </span>{" "}
              –{" "}
              <span className="font-mono tabular-nums">
                {props.period.endDate}
              </span>
            </p>
          ) : null}
          {props.fixDeadline ? (
            <p className="text-xs text-warn-700 mt-1">
              Employee fix window closes {props.fixDeadline}
            </p>
          ) : null}
        </div>
      </div>

      <RunProgress state={props.state} className="relative mb-6" />

      {props.stats && (props.stats.employeeCount > 0 || props.stats.gross > 0) ? (
        <div className="relative grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Stat label="Employees" value={String(props.stats.employeeCount)} />
          <Stat
            label="Hours"
            value={
              <HoursDisplay
                hours={props.stats.hours}
                decimals={props.hoursDecimalPlaces ?? 2}
              />
            }
          />
          <Stat
            label="Gross"
            value={<MoneyDisplay cents={props.stats.gross} monospace />}
          />
          <Stat
            label="Net (rounded)"
            value={<MoneyDisplay cents={props.stats.rounded} monospace />}
          />
        </div>
      ) : null}

      <div className="relative mt-auto flex flex-wrap items-center gap-3">
        {primaryAction(props)}
        {secondaryAction(props)}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-card bg-surface-2/60 border border-border/60 p-4">
      <div className="text-[10px] uppercase tracking-wider text-text-subtle font-medium">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1 font-mono tabular-nums tracking-tight">
        {value}
      </div>
    </div>
  );
}

const STEPS = [
  { key: "ingest", label: "Ingest" },
  { key: "fix", label: "Fix window" },
  { key: "review", label: "Review" },
  { key: "publish", label: "Publish" },
] as const;

function progressFor(state: State): {
  step: number; // 0..STEPS.length-1
  failed: boolean;
} {
  switch (state) {
    case "NO_RUN":
    case "CANCELLED":
      return { step: -1, failed: false };
    case "SCHEDULED":
      return { step: 0, failed: false };
    case "INGESTING":
      return { step: 0, failed: false };
    case "INGEST_FAILED":
      return { step: 0, failed: true };
    case "AWAITING_EMPLOYEE_FIXES":
      return { step: 1, failed: false };
    case "AWAITING_ADMIN_REVIEW":
      return { step: 2, failed: false };
    case "APPROVED":
      return { step: 3, failed: false };
    case "PUBLISHED":
      return { step: 3, failed: false };
    case "FAILED":
      return { step: 3, failed: true };
  }
}

function RunProgress({ state, className }: { state: State; className?: string }) {
  if (state === "NO_RUN" || state === "CANCELLED") return null;
  const { step, failed } = progressFor(state);
  const isPublished = state === "PUBLISHED";
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const isDone = i < step || isPublished;
          const isActive = i === step && !isPublished;
          const isFailed = isActive && failed;
          return (
            <div key={s.key} className="flex-1 h-1.5 rounded-full overflow-hidden bg-surface-2">
              <div
                className={cn(
                  "h-full transition-all",
                  isFailed
                    ? "bg-danger-700"
                    : isDone
                      ? "bg-brand-700"
                      : isActive
                        ? "bg-brand-700/60 animate-pulse"
                        : "bg-transparent",
                )}
                style={{ width: isDone || isActive ? "100%" : "0%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-subtle">
        {STEPS.map((s, i) => {
          const isDone = i < step || isPublished;
          const isActive = i === step && !isPublished;
          return (
            <div
              key={s.key}
              className={cn(
                "flex-1 truncate",
                isDone || isActive ? "text-text-muted font-medium" : "",
              )}
            >
              {s.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function primaryAction(props: PayrollRunCardProps): React.ReactNode {
  switch (props.state) {
    case "AWAITING_ADMIN_REVIEW":
    case "AWAITING_EMPLOYEE_FIXES":
      return (
        <Button asChild size="lg">
          <Link href={props.runId ? `/payroll/run/${props.runId}` : "/payroll"}>
            Open run for review
          </Link>
        </Button>
      );
    case "INGEST_FAILED":
      return (
        <Button asChild size="lg" variant="destructive">
          <Link href={props.runId ? `/ngteco/${props.runId}` : "/ngteco"}>
            View failure
          </Link>
        </Button>
      );
    case "PUBLISHED":
      return (
        <Button asChild size="lg" variant="secondary">
          <Link href={props.runId ? `/payroll/run/${props.runId}` : "/payroll"}>
            View published run
          </Link>
        </Button>
      );
    case "INGESTING":
    case "APPROVED":
      return (
        <Button asChild size="lg" variant="secondary">
          <Link href={props.runId ? `/ngteco/${props.runId}` : "/ngteco"}>
            View progress
          </Link>
        </Button>
      );
    case "NO_RUN":
      return (
        <Button asChild size="lg" variant="secondary">
          <Link href="/settings/ngteco">Configure NGTeco</Link>
        </Button>
      );
    default:
      return (
        <Button asChild size="lg" variant="secondary">
          <Link href="/payroll">Payroll history</Link>
        </Button>
      );
  }
}

function secondaryAction(props: PayrollRunCardProps): React.ReactNode {
  if (props.state === "AWAITING_EMPLOYEE_FIXES") {
    return (
      <Button asChild variant="ghost">
        <Link href="/requests">View open requests</Link>
      </Button>
    );
  }
  if (props.state === "AWAITING_ADMIN_REVIEW" && props.stats?.unresolvedAlerts) {
    return (
      <span className="inline-flex items-center gap-2 text-sm text-warn-700">
        <CalendarCheck className="h-4 w-4" />
        {props.stats.unresolvedAlerts} unresolved alert
        {props.stats.unresolvedAlerts === 1 ? "" : "s"}
      </span>
    );
  }
  return null;
}
