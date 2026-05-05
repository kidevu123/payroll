// Premium payslip summary card — used in the employee Pay tab and in
// the admin's per-employee timeline.
//
// Visual brief: substantial card, period dates as the headline, hours +
// net as the subhead, StatusPill on the right. The whole card is the
// click target (no separate Open button); a chevron hints at the
// affordance. Disputed payslips get a subtle amber inset on the left.
//
// One strong cue per surface — we lean on the card chrome (border + soft
// shadow) and let the StatusPill carry the state color, instead of also
// recoloring the entire card border.
//
// Money is integer cents. Display lifts it to a 2xl tabular-nums hero
// number, with hours quietly preceding it as context.
//
// State semantics:
//   pending      — run not published yet (rare in employee view)
//   published    — visible, not yet acknowledged
//   acknowledged — employee confirmed they reviewed it
//   disputed     — employee reported a problem; admin notified

import * as React from "react";
import Link from "next/link";
import { ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusPill, type StatusKind } from "./status-pill";
import { MoneyDisplay } from "./money-display";
import { HoursDisplay } from "./hours-display";

export type PayslipCardState =
  | "pending"
  | "published"
  | "acknowledged"
  | "disputed";

export type PayslipCardProps = {
  payslipId: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  roundedCents: number;
  state: PayslipCardState;
  hoursDecimalPlaces?: number;
  href?: string;
  className?: string;
};

const STATE_TO_PILL: Record<PayslipCardState, StatusKind> = {
  pending: "PENDING",
  published: "PUBLISHED",
  acknowledged: "APPROVED",
  // No matching StatusPill kind for "disputed" — render a custom inline
  // chip below instead. We default the pill mapping to PENDING so the
  // type is total; the caller renders the chip not the pill.
  disputed: "PENDING",
};

const PILL_LABEL_OVERRIDE: Partial<Record<PayslipCardState, string>> = {
  acknowledged: "Acknowledged",
  published: "Awaiting review",
};

export function PayslipCard(props: PayslipCardProps) {
  const isDisputed = props.state === "disputed";
  const decimals = props.hoursDecimalPlaces ?? 2;

  const inner = (
    <div
      className={cn(
        // Soft card chrome; hover lifts the shadow only — no transform.
        "group relative overflow-hidden rounded-card bg-surface border border-border/70 shadow-card",
        "transition-shadow duration-200 hover:shadow-card-hover",
        // Disputed: subtle amber inset on the left edge — one strong cue.
        isDisputed &&
          "before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-warn-700/80",
        props.className,
      )}
    >
      <div className="px-5 py-4 sm:px-6 sm:py-5 flex items-center gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold tracking-tight antialiased text-text">
              {props.periodStart}{" "}
              <span className="text-text-subtle">–</span>{" "}
              {props.periodEnd}
            </h3>
            {isDisputed ? (
              <span className="inline-flex items-center gap-1 rounded-chip border border-warn-200/80 bg-warn-50 px-2 py-0.5 text-[11px] font-medium tracking-tight text-warn-700">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                Problem reported
              </span>
            ) : (
              <CardPill state={props.state} />
            )}
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-semibold tracking-tight tabular-nums text-text">
              <MoneyDisplay
                cents={props.roundedCents}
                monospace={false}
                className="font-semibold"
              />
            </span>
            <span className="text-xs text-text-muted">
              <HoursDisplay hours={props.hours} decimals={decimals} />{" "}
              <span className="text-text-subtle">hrs</span>
            </span>
          </div>
        </div>
        <ChevronRight
          className="h-5 w-5 shrink-0 text-text-subtle transition-colors group-hover:text-text-muted"
          aria-hidden
        />
      </div>
    </div>
  );

  if (!props.href) return inner;
  return (
    <Link
      href={props.href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-2 focus-visible:ring-offset-page rounded-card"
      aria-label={`Open payslip for ${props.periodStart} to ${props.periodEnd}`}
    >
      {inner}
    </Link>
  );
}

function CardPill({ state }: { state: PayslipCardState }) {
  const pillKind = STATE_TO_PILL[state];
  const override = PILL_LABEL_OVERRIDE[state];
  if (!override) return <StatusPill status={pillKind} />;
  // We want a friendlier label than the StatusPill default — render the
  // same chrome inline so visual weight matches the rest of the system.
  // Style mirrors StatusPill 'success'/'info' kinds.
  const tone =
    state === "acknowledged"
      ? "bg-success-50 text-success-700 border-success-200/80"
      : "bg-info-50 text-info-700 border-info-200/80";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-[11px] font-medium tracking-tight antialiased",
        tone,
      )}
    >
      {override}
    </span>
  );
}
