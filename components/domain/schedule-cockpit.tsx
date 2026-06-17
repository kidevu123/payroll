// Dashboard cockpit: one box per active pay schedule (Weekly / Semi-monthly /
// Monthly), each showing that period's own total and the correct next action.
// Totals are per-period and never summed across schedules.

import Link from "next/link";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Clock,
  PlayCircle,
  Users,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "./money-display";
import { HoursDisplay } from "./hours-display";
import type { CockpitRow } from "@/lib/payroll/schedule-cockpit";

type Next = {
  label: string;
  href: string;
  variant: "default" | "secondary" | "ghost";
  badge: string;
  tone: "neutral" | "info" | "warn" | "success";
};

function nextStep(row: CockpitRow): Next {
  if (!row.period) {
    return {
      label: "Set up schedule",
      href: "/settings/pay-schedules",
      variant: "ghost",
      badge: "No period",
      tone: "neutral",
    };
  }
  if (row.period.state === "PAID") {
    return {
      label: "View",
      href: `/payroll/${row.period.id}`,
      variant: "ghost",
      badge: "Paid",
      tone: "success",
    };
  }
  const runHref = row.runId
    ? `/payroll/run/${row.runId}`
    : `/payroll/${row.period.id}`;
  switch (row.runState) {
    case "AWAITING_ADMIN_REVIEW":
    case "AWAITING_EMPLOYEE_FIXES":
      return {
        label: "Review",
        href: runHref,
        variant: "default",
        badge: "Needs review",
        tone: "warn",
      };
    case "APPROVED":
      return {
        label: "Publish",
        href: runHref,
        variant: "default",
        badge: "Approved",
        tone: "info",
      };
    case "PUBLISHED":
      // Payslips sent for confirmation — NOT paid yet. Next step is payment.
      return {
        label: "Mark paid",
        href: `/payroll/${row.period.id}`,
        variant: "secondary",
        badge: "Awaiting payment",
        tone: "info",
      };
    case "SCHEDULED":
    case "INGESTING":
      return {
        label: "View progress",
        href: runHref,
        variant: "secondary",
        badge: "Running",
        tone: "info",
      };
    case "INGEST_FAILED":
    case "FAILED":
      return {
        label: "View failure",
        href: runHref,
        variant: "secondary",
        badge: "Failed",
        tone: "warn",
      };
    default:
      return {
        label: "Start payroll run",
        href: `/payroll/${row.period.id}`,
        variant: "default",
        badge: "Not started",
        tone: "neutral",
      };
  }
}

const BADGE_TONE: Record<Next["tone"], string> = {
  neutral: "border-border bg-surface-2 text-text-muted",
  info: "border-info-200 bg-info-50 text-info-700",
  warn: "border-warn-300 bg-warn-50 text-warn-700",
  success: "border-success-200 bg-success-50 text-success-700",
};

const TONE_ICON: Record<Next["tone"], React.ComponentType<{ className?: string }>> = {
  neutral: Clock,
  info: PlayCircle,
  warn: CircleAlert,
  success: CircleCheck,
};

/**
 * Map a schedule's cadence to its signature accent class (defined in
 * globals.css). The class sets --cadence-gradient + --cadence-glow which the
 * accent bar, label, and hover glow consume. Falls back to the brand gradient.
 */
function cadenceClass(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("week")) return "cadence-weekly";
  if (n.includes("semi") || n.includes("bi-month") || n.includes("twice"))
    return "cadence-semimonthly";
  if (n.includes("month")) return "cadence-monthly";
  return "cadence-default";
}

export function ScheduleCockpit({
  rows,
  hoursDecimalPlaces = 2,
}: {
  rows: CockpitRow[];
  hoursDecimalPlaces?: number;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="cockpit-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="cockpit-heading"
          className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle"
        >
          This cycle
        </h2>
        <span className="text-xs text-text-subtle">
          Each schedule pays its own period — never combined.
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const next = nextStep(row);
          const Icon = TONE_ICON[next.tone];
          const cadence = cadenceClass(row.scheduleName);
          // Signature CTA gets the gradient fill; non-primary steps keep their
          // calmer treatment so "review/publish" stays the visual hero.
          const isPrimary = next.variant === "default";
          return (
            <div
              key={row.scheduleId}
              className={`signature-card group relative flex flex-col overflow-hidden rounded-signature border border-border bg-surface shadow-signature ${cadence}`}
            >
              {/* Top cadence accent bar — the per-schedule color signature. */}
              <div
                aria-hidden
                className="cadence-bar h-1.5 w-full"
              />
              {/* Soft corner glow in the cadence hue, behind the content. */}
              <div
                aria-hidden
                className="cadence-bar pointer-events-none absolute -right-10 -top-8 h-28 w-28 rounded-full opacity-[0.10] blur-2xl"
              />

              <div className="flex flex-1 flex-col p-5">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
                      <Wallet className="h-4 w-4 shrink-0 text-brand-700" />
                      {row.scheduleName}
                    </div>
                    {row.period ? (
                      <p className="mt-1 font-mono text-xs tabular-nums text-text-muted">
                        {row.period.startDate} – {row.period.endDate}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-text-muted">
                        No active period
                      </p>
                    )}
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-chip border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BADGE_TONE[next.tone]}`}
                  >
                    <Icon className="h-3 w-3" />
                    {next.badge}
                  </span>
                </div>

                {/* The hero: an oversized period total. Money leads the card. */}
                <div className="mb-5">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">
                    Total this period
                  </div>
                  <div className="mt-0.5 font-mono text-[2.5rem] font-bold leading-none tabular-nums tracking-tight text-text">
                    <MoneyDisplay cents={row.grossCents} monospace />
                  </div>
                  <div className="mt-2.5 flex items-center gap-3 text-xs text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-text-subtle" />
                      {row.employeeCount} emp
                      {row.employeeCount === 1 ? "" : "s"}
                    </span>
                    <span aria-hidden className="text-border-strong">
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <Clock className="h-3.5 w-3.5 text-text-subtle" />
                      <HoursDisplay
                        hours={row.hours}
                        decimals={hoursDecimalPlaces}
                      />
                      h
                    </span>
                  </div>
                </div>

                <div className="mt-auto flex items-center gap-2">
                  <Button
                    asChild
                    size="sm"
                    variant={isPrimary ? "gradient" : next.variant}
                    className="flex-1 justify-center"
                  >
                    <Link href={next.href}>
                      {next.label}
                      {isPrimary && <ArrowRight className="h-4 w-4" />}
                    </Link>
                  </Button>
                  {row.unresolvedAlerts > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-chip border border-warn-300 bg-warn-50 px-2 py-1 text-[11px] font-medium text-warn-700">
                      <CircleAlert className="h-3.5 w-3.5" />
                      {row.unresolvedAlerts}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
