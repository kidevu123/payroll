// Dashboard centerpiece — fills ~50% of viewport with a state-driven CTA.
// State sets the tone, the headline, the supporting line, and the single
// primary action. Secondary actions show as quieter links underneath.

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

const COPY: Record<
  State,
  {
    headline: string;
    sub: string;
    Icon: React.ComponentType<{ className?: string }>;
    accent: string;
  }
> = {
  NO_RUN: {
    headline: "No payroll run yet",
    sub: "The next run starts on the configured cron, or you can trigger one manually.",
    Icon: Workflow,
    accent: "text-[--text-muted]",
  },
  SCHEDULED: {
    headline: "Run scheduled",
    sub: "The ingest will start at the next tick.",
    Icon: CalendarClock,
    accent: "text-sky-700",
  },
  INGESTING: {
    headline: "Pulling punches from NGTeco",
    sub: "This usually takes under a minute. Watch /ngteco for live progress.",
    Icon: Workflow,
    accent: "text-sky-700",
  },
  INGEST_FAILED: {
    headline: "Ingest failed",
    sub: "Retry or open the run for the captured screenshot.",
    Icon: CircleX,
    accent: "text-red-700",
  },
  AWAITING_EMPLOYEE_FIXES: {
    headline: "Waiting on employee fixes",
    sub: "Missed-punch alerts went out. The fix window closes automatically — you can also advance to review now.",
    Icon: Hourglass,
    accent: "text-amber-700",
  },
  AWAITING_ADMIN_REVIEW: {
    headline: "Ready for review",
    sub: "Confirm hours and approve to publish payslips.",
    Icon: CircleAlert,
    accent: "text-amber-800",
  },
  APPROVED: {
    headline: "Approved — generating payslips",
    sub: "PDFs are landing. The run will flip to Published in a moment.",
    Icon: PlayCircle,
    accent: "text-sky-700",
  },
  PUBLISHED: {
    headline: "Payroll published",
    sub: "Payslips delivered. The Sunday close is done.",
    Icon: CircleCheck,
    accent: "text-emerald-700",
  },
  FAILED: {
    headline: "Run failed mid-publish",
    sub: "Some payslips may have been written. Retry the publish step.",
    Icon: CircleX,
    accent: "text-red-700",
  },
  CANCELLED: {
    headline: "Run cancelled",
    sub: "Start a new run when ready.",
    Icon: Clock,
    accent: "text-[--text-muted]",
  },
};

export function PayrollRunCard(props: PayrollRunCardProps) {
  const c = COPY[props.state];
  const { Icon } = c;
  return (
    <div
      className={cn(
        "rounded-[--radius-card] border-2 bg-[--surface] p-8 lg:p-10",
        "min-h-[24rem] flex flex-col",
        props.state === "AWAITING_ADMIN_REVIEW" || props.state === "INGEST_FAILED"
          ? "border-[--color-brand-700]"
          : "border-[--border]",
      )}
    >
      <div className="flex items-start gap-4 mb-6">
        <Icon className={cn("h-10 w-10 shrink-0", c.accent)} aria-hidden="true" />
        <div className="flex-1">
          <h2 className="text-2xl font-semibold tracking-tight">{c.headline}</h2>
          <p className="text-sm text-[--text-muted] mt-1 max-w-2xl">{c.sub}</p>
          {props.period ? (
            <p className="text-xs text-[--text-muted] mt-3">
              Period: <span className="font-mono">{props.period.startDate}</span> –{" "}
              <span className="font-mono">{props.period.endDate}</span>
            </p>
          ) : null}
          {props.fixDeadline ? (
            <p className="text-xs text-amber-700 mt-1">
              Employee fix window closes {props.fixDeadline}
            </p>
          ) : null}
        </div>
      </div>

      {props.stats && (props.stats.employeeCount > 0 || props.stats.gross > 0) ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
          <Stat label="Gross" value={<MoneyDisplay cents={props.stats.gross} monospace={false} />} />
          <Stat
            label="Net (rounded)"
            value={<MoneyDisplay cents={props.stats.rounded} monospace={false} />}
          />
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-3">
        {primaryAction(props)}
        {secondaryAction(props)}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-[--radius-card] bg-[--surface-2] p-4">
      <div className="text-[10px] uppercase tracking-wide text-[--text-muted]">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function primaryAction(props: PayrollRunCardProps): React.ReactNode {
  switch (props.state) {
    case "AWAITING_ADMIN_REVIEW":
    case "AWAITING_EMPLOYEE_FIXES":
      return (
        <Button asChild size="lg">
          <Link href={props.runId ? `/payroll/${props.runId}` : "/payroll"}>
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
          <Link href={props.runId ? `/payroll/${props.runId}` : "/payroll"}>
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
      <span className="inline-flex items-center gap-2 text-sm text-amber-700">
        <CalendarCheck className="h-4 w-4" /> {props.stats.unresolvedAlerts} unresolved alert{props.stats.unresolvedAlerts === 1 ? "" : "s"}
      </span>
    );
  }
  return null;
}
