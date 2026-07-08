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
import { PdfLink } from "@/components/domain/pdf-link";
import { ChevronRight, AlertTriangle, FileText, Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { PayslipPdfActions, payslipPdfHref } from "@/components/domain/payslip-pdf-actions";
import { StatusPill, type StatusKind } from "./status-pill";
import { MoneyDisplay } from "./money-display";
import { HoursDisplay } from "./hours-display";

export type PayslipCardDoc = {
  id: string;
  originalFilename: string;
  kind: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  amountCents: number | null;
};

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
  /**
   * Optional documents (paystubs, W2s) attached to this period. When
   * present, render INSIDE the card's chrome below the link area so
   * the period and its uploads read as one row, not two stacked
   * cards.
   */
  docs?: PayslipCardDoc[];
  /** Localised "View" label for the doc download buttons. */
  viewLabel?: string;
  /** When set, show Print / Download for the official PDF payslip. */
  printPdfUrl?: string;
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

export function PayslipCard(props: PayslipCardProps) {
  const t = useTranslations("employee.pay");
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
      <div className="px-4 py-3 flex items-center gap-4">
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
                {t("problemReported")}
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
              <span className="text-text-subtle">{t("hours").toLowerCase()}</span>
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

  // Documents (paystubs, W2s) render INSIDE the same chrome so the
  // period and its uploads read as one connected row, not two stacked
  // cards. Owner ask: "i want it inside the pay period so the user
  // can see all the information about that pay week in one tab".
  const docsSection =
    props.docs && props.docs.length > 0 ? (
      <div className="border-t border-border/60 bg-surface-2/30 px-4 py-3 sm:px-5 sm:py-3.5 space-y-1.5">
        {props.docs.map((d) => (
          <DocRow key={d.id} doc={d} viewLabel={props.viewLabel ?? "View"} />
        ))}
      </div>
    ) : null;

  const printSection = props.printPdfUrl ? (
    <PayslipPdfActions
      url={props.printPdfUrl}
      printLabel={t("printPayslip")}
      downloadLabel={t("downloadPayslip")}
    />
  ) : null;

  // Wrap the link area + the docs section in a single chrome `div` so
  // the docs sit visually inside the period card. We can't put the
  // doc download `<a>` tags inside the outer `<Link>` (nested anchors
  // are invalid), so the link only wraps the header area.
  const linkArea = props.href ? (
    <Link
      href={props.href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-2 focus-visible:ring-offset-page rounded-card"
      aria-label={`Open payslip for ${props.periodStart} to ${props.periodEnd}`}
    >
      {inner}
    </Link>
  ) : (
    inner
  );

  if (!docsSection && !printSection) return linkArea;

  return (
    <div
      className={cn(
        "rounded-card overflow-hidden border border-border/70 bg-surface shadow-card",
        isDisputed && "ring-1 ring-warn-200/70",
        props.className,
      )}
    >
      <div className="[&>div]:border-0 [&>div]:rounded-none [&>div]:shadow-none [&>a>div]:border-0 [&>a>div]:rounded-none [&>a>div]:shadow-none">
        {linkArea}
      </div>
      {printSection}
      {docsSection}
    </div>
  );
}

function DocRow({ doc, viewLabel }: { doc: PayslipCardDoc; viewLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-input bg-brand-50 ring-1 ring-inset ring-brand-100">
          <FileText className="h-3.5 w-3.5 text-brand-700" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-text antialiased">
            {doc.originalFilename}
          </p>
          <p className="text-[10px] text-text-muted leading-relaxed">
            {doc.kind}
            {doc.payPeriodStart && doc.payPeriodEnd
              ? ` · ${doc.payPeriodStart} – ${doc.payPeriodEnd}`
              : ""}
            {doc.amountCents !== null && doc.amountCents > 0
              ? ` · $${(doc.amountCents / 100).toFixed(2)}`
              : ""}
          </p>
        </div>
      </div>
      <PdfLink
        href={`/api/payroll-docs/${doc.id}`}
        filename="paystub.pdf"
        className="inline-flex items-center gap-1 rounded-input border border-border bg-surface px-2.5 py-1 text-[11px] font-medium tracking-tight text-text-muted transition-colors hover:bg-surface-2 hover:text-text shrink-0"
      >
        <Download className="h-3 w-3" /> {viewLabel}
      </PdfLink>
    </div>
  );
}

function CardPill({ state }: { state: PayslipCardState }) {
  const t = useTranslations("employee.pay");
  const pillKind = STATE_TO_PILL[state];
  const override =
    state === "acknowledged"
      ? t("stateAcknowledged")
      : state === "published"
        ? t("statePending")
        : null;
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
