// Dark cadence card: one per active pay schedule (Monthly / Semi-monthly /
// Weekly). Shows the current open period total, a violet glowing sparkline of
// recent period totals, headcount + hours, a delta vs prior period, an alert
// chip, and the correct next-step button. Server component — data comes pre-
// shaped from computeDashboardMetrics; only the chart child is "use client".

import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CalendarRange,
  Clock4,
  Layers,
  Users,
} from "lucide-react";
import { formatMoney, formatHoursMinutes } from "@/lib/utils";
import { CadenceSparkline } from "./charts/cadence-sparkline";
import { DashCard, Delta, Eyebrow } from "./dash-primitives";
import { DASH } from "./theme";
import type { CadenceCard as CadenceData } from "@/lib/payroll/dashboard-metrics";

type NextStep = {
  label: string;
  href: string;
  badge: string;
  primary: boolean;
};

function resolveNextStep(card: CadenceData): NextStep {
  if (!card.period) {
    return {
      label: "Set up schedule",
      href: "/settings/pay-schedules",
      badge: "No period",
      primary: false,
    };
  }
  const runHref = card.runId
    ? `/payroll/run/${card.runId}`
    : `/payroll/${card.period.id}`;
  if (card.period.state === "PAID") {
    return { label: "View run", href: `/payroll/${card.period.id}`, badge: "Paid", primary: false };
  }
  switch (card.runState) {
    case "AWAITING_ADMIN_REVIEW":
    case "AWAITING_EMPLOYEE_FIXES":
      return { label: "Review run", href: runHref, badge: "Needs review", primary: true };
    case "APPROVED":
      return { label: "Publish run", href: runHref, badge: "Approved", primary: true };
    case "PUBLISHED":
      return { label: "Mark paid", href: `/payroll/${card.period.id}`, badge: "Awaiting payment", primary: true };
    case "SCHEDULED":
    case "INGESTING":
      return { label: "View progress", href: runHref, badge: "Running", primary: false };
    case "INGEST_FAILED":
    case "FAILED":
      return { label: "View failure", href: runHref, badge: "Failed", primary: false };
    default:
      return { label: "Start payroll run", href: `/payroll/${card.period.id}`, badge: "Not started", primary: true };
  }
}

function badgeStyle(badge: string): { color: string; bg: string } {
  switch (badge) {
    case "Needs review":
    case "Failed":
      return { color: DASH.amber, bg: "rgba(251,191,36,0.12)" };
    case "Approved":
    case "Running":
    case "Awaiting payment":
      return { color: DASH.violetBright, bg: "rgba(139,92,246,0.14)" };
    case "Paid":
      return { color: DASH.emerald, bg: "rgba(52,211,153,0.12)" };
    default:
      return { color: DASH.textMuted, bg: "rgba(255,255,255,0.06)" };
  }
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  MONTHLY: CalendarRange,
  SEMI_MONTHLY: Layers,
  WEEKLY: Clock4,
  BIWEEKLY: Layers,
};

function shortRange(startIso: string, endIso: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number) as [number, number, number];
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2000, m - 1, d)));
  };
  return `${fmt(startIso)} – ${fmt(endIso)}`;
}

export function CadenceCard({ card }: { card: CadenceData }) {
  const step = resolveNextStep(card);
  const badge = badgeStyle(step.badge);
  const Icon = KIND_ICON[card.periodKind] ?? CalendarRange;

  return (
    <DashCard glow={step.primary} className="flex h-full flex-col gap-2.5">
      {/* Header: icon + uppercase cadence name + range, status badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{
              background: "rgba(139,92,246,0.14)",
              border: `1px solid ${DASH.border}`,
            }}
          >
            <Icon className="h-4 w-4" style={{ color: DASH.violetBright }} />
          </span>
          <div>
            <div
              className="text-[13px] font-bold uppercase tracking-[0.04em]"
              style={{ color: DASH.text }}
            >
              {card.scheduleName}
            </div>
            <div className="text-[11px]" style={{ color: DASH.textFaint }}>
              {card.period
                ? shortRange(card.period.startDate, card.period.endDate)
                : "No open period"}
            </div>
          </div>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: badge.color, background: badge.bg }}
        >
          {step.badge}
        </span>
      </div>

      {/* Hero figure (left) + glowing sparkline (right) */}
      <div className="grid grid-cols-[minmax(0,1fr)_42%] items-center gap-2">
        <div className="min-w-0">
          <Eyebrow>Total pay period</Eyebrow>
          <div
            className="mt-1.5 text-[1.65rem] font-bold leading-none tracking-[-0.02em] tabular-nums"
            style={{ color: DASH.text }}
          >
            {formatMoney(card.totalCents)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Delta pct={card.deltaPct} />
            {card.priorRangeLabel ? (
              <span className="text-[11px]" style={{ color: DASH.textFaint }}>
                vs {card.priorRangeLabel}
              </span>
            ) : null}
          </div>
          <div
            className="mt-2 flex items-center gap-3 text-[11px]"
            style={{ color: DASH.textMuted }}
          >
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" aria-hidden="true" />
              {card.employeeCount} emp
            </span>
            <span aria-hidden="true" style={{ color: DASH.textFaint }}>·</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock4 className="h-3 w-3" aria-hidden="true" />
              {formatHoursMinutes(card.hours)}
            </span>
          </div>
        </div>
        <CadenceSparkline
          data={card.spark}
          gradientId={`spark-${card.scheduleId}`}
          className="h-16"
        />
      </div>

      {/* Footer: full-width action + alert pill */}
      <div className="flex items-center gap-2.5">
        <Link
          href={step.href}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold transition-colors"
          style={
            step.primary
              ? {
                  color: "#0b0b12",
                  background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
                  boxShadow: "0 8px 20px -10px rgba(124,58,237,0.7)",
                }
              : {
                  color: DASH.text,
                  background: "rgba(255,255,255,0.06)",
                  border: `1px solid ${DASH.border}`,
                }
          }
        >
          {step.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        {card.unresolvedAlerts > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-[12px] font-semibold tabular-nums"
            style={{ color: DASH.rose, background: "rgba(251,113,133,0.12)" }}
            title={`${card.unresolvedAlerts} unresolved alerts`}
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {card.unresolvedAlerts}
          </span>
        ) : (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-2 text-[12px] font-semibold"
            style={{ color: DASH.emerald, background: "rgba(52,211,153,0.12)" }}
            title="No alerts"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />0
          </span>
        )}
      </div>
    </DashCard>
  );
}
