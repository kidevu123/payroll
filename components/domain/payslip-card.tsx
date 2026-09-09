// One payslip on the employee Pay tab (owner: "make my pay page look
// significantly better", Sep 2026). A card is one pay period: friendly
// date range + status chip, the net figure with hours beside it, and a
// quiet action row — View (opens the PDF in-app, never a share sheet) and
// Share (the native sheet: AirPrint, Save to Files). Uploaded paystubs sit
// inside the same card as slim document rows with the same two actions.
//
// Status vocabulary:
//   published    — visible, waiting on the employee ("Needs your OK")
//   acknowledged — the employee confirmed it
//   disputed     — the employee reported a problem
//   pending      — generated, not yet published (never shown here)

"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, ChevronRight, Eye, FileText, Share } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { PdfLink } from "@/components/domain/pdf-link";
import { formatPeriodRange } from "@/lib/payroll/format-period";
import { cn } from "@/lib/utils";

export type PayslipCardDoc = {
  id: string;
  originalFilename: string;
  kind: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  amountCents: number | null;
};

export type PayslipCardState = "pending" | "published" | "acknowledged" | "disputed";

export type PayslipCardProps = {
  payslipId: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  roundedCents: number;
  hoursDecimalPlaces?: number;
  state: PayslipCardState;
  href?: string;
  /** When set, show View / Share for the official PDF payslip. */
  printPdfUrl?: string;
  docs?: PayslipCardDoc[];
  viewLabel?: string;
  className?: string;
};

function StateChip({ state }: { state: PayslipCardState }) {
  const t = useTranslations("employee.pay");
  if (state === "disputed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-chip border border-warning-200/80 bg-warning-50 px-2 py-0.5 text-[11px] font-medium text-warning-700">
        <AlertTriangle className="h-3 w-3" aria-hidden /> {t("problemReported")}
      </span>
    );
  }
  if (state === "acknowledged") {
    return (
      <span className="inline-flex items-center gap-1 rounded-chip border border-success-200/80 bg-success-50 px-2 py-0.5 text-[11px] font-medium text-success-700">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> {t("stateAcknowledged")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-chip border border-brand-200/80 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
      {t("needsApproval")}
    </span>
  );
}

const ACTION =
  "inline-flex min-h-9 items-center gap-1.5 rounded-input border border-border bg-surface px-3 text-xs font-medium text-text-muted transition-colors hover:bg-surface-2/40 hover:text-text [@media(pointer:coarse)]:min-h-10";

export function PayslipCard(props: PayslipCardProps) {
  const t = useTranslations("employee.pay");
  const decimals = props.hoursDecimalPlaces ?? 2;
  const needsOk = props.state === "published";
  const range = formatPeriodRange(props.periodStart, props.periodEnd);

  const header = (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium tracking-tight text-text">{range}</h3>
          <StateChip state={props.state} />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-text">
            <MoneyDisplay cents={props.roundedCents} monospace={false} />
          </span>
          <span className="text-xs text-text-muted tabular-nums">
            <HoursDisplay hours={props.hours} decimals={decimals} />{" "}
            <span className="text-text-subtle">{t("hours").toLowerCase()}</span>
          </span>
        </div>
      </div>
      {props.href ? (
        <ChevronRight className="h-5 w-5 shrink-0 text-text-subtle" aria-hidden />
      ) : null}
    </div>
  );

  const headerArea = props.href ? (
    <Link
      href={props.href}
      className="block transition-colors hover:bg-surface-2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700/60"
      aria-label={`Open payslip for ${range}`}
    >
      {header}
    </Link>
  ) : (
    header
  );

  const hasActions = props.printPdfUrl || (props.docs && props.docs.length > 0);

  return (
    <article
      className={cn(
        "overflow-hidden rounded-card border bg-surface shadow-card",
        needsOk ? "border-brand-200/80" : "border-border/70",
        props.state === "disputed" && "border-warning-200/80",
        props.className,
      )}
    >
      {headerArea}
      {hasActions ? (
        <div className="divide-y divide-border/60 border-t border-border/60 bg-surface-2/30">
          {props.printPdfUrl ? (
            <DocLine
              icon={<FileText className="h-3.5 w-3.5 text-brand-700" aria-hidden />}
              title={t("payslipPdf")}
              meta={range}
              href={props.printPdfUrl}
              filename="payslip.pdf"
              viewLabel={t("view")}
              shareLabel={t("share")}
            />
          ) : null}
          {props.docs?.map((d) => (
            <DocLine
              key={d.id}
              icon={<FileText className="h-3.5 w-3.5 text-info-700" aria-hidden />}
              title={docTitle(d)}
              meta={docMeta(d)}
              href={`/api/payroll-docs/${d.id}`}
              filename={d.originalFilename || "paystub.pdf"}
              viewLabel={props.viewLabel ?? t("view")}
              shareLabel={t("share")}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function docTitle(d: PayslipCardDoc): string {
  const kind = d.kind === "PAYSTUB" ? "Paystub" : d.kind === "W2" ? "W-2" : "Document";
  return d.amountCents !== null && d.amountCents > 0 ? kind : `${kind} · ${d.originalFilename}`;
}

function docMeta(d: PayslipCardDoc): string {
  const parts: string[] = [];
  if (d.payPeriodStart && d.payPeriodEnd) parts.push(formatPeriodRange(d.payPeriodStart, d.payPeriodEnd));
  if (d.amountCents !== null && d.amountCents > 0) parts.push(`$${(d.amountCents / 100).toFixed(2)} take-home`);
  return parts.join(" · ");
}

export function DocLine({
  icon,
  title,
  meta,
  href,
  filename,
  viewLabel,
  shareLabel,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  href: string;
  filename: string;
  viewLabel: string;
  shareLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-input bg-surface ring-1 ring-inset ring-border/70">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-text">{title}</p>
        {meta ? <p className="truncate text-[11px] text-text-subtle">{meta}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <PdfLink href={href} filename={filename} intent="view" className={ACTION}>
          <Eye className="h-3.5 w-3.5" aria-hidden /> {viewLabel}
        </PdfLink>
        <PdfLink
          href={href}
          filename={filename}
          intent="share"
          aria-label={shareLabel}
          title={shareLabel}
          className={cn(ACTION, "px-2.5")}
        >
          <Share className="h-3.5 w-3.5" aria-hidden />
        </PdfLink>
      </div>
    </div>
  );
}
