// Three-state payslip summary card. Used in the employee Pay tab and in
// the admin's per-employee timeline.

import * as React from "react";
import Link from "next/link";
import { CircleCheck, Clock3, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "./money-display";
import { HoursDisplay } from "./hours-display";

export type PayslipCardProps = {
  payslipId: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  roundedCents: number;
  /** State derives from the row: published-but-not-acknowledged is most
   *  prominent. Pending = run hasn't published yet. */
  state: "pending" | "published" | "acknowledged";
  hoursDecimalPlaces?: number;
  href?: string;
  className?: string;
};

const META: Record<
  PayslipCardProps["state"],
  { label: string; tone: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  pending: {
    label: "Pending review",
    tone: "border-border bg-surface",
    Icon: Clock3,
  },
  published: {
    label: "Published",
    tone: "border-brand-700 bg-surface",
    Icon: FileText,
  },
  acknowledged: {
    label: "Acknowledged",
    tone: "border-success-200 bg-success-50/40",
    Icon: CircleCheck,
  },
};

export function PayslipCard(props: PayslipCardProps) {
  const m = META[props.state];
  const { Icon } = m;
  return (
    <div
      className={cn(
        "rounded-card border-2 p-5 flex items-center gap-4",
        m.tone,
        props.className,
      )}
    >
      <Icon className="h-8 w-8 shrink-0 text-brand-700" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">
            {props.periodStart} – {props.periodEnd}
          </span>
          <span className="text-xs text-text-muted">{m.label}</span>
        </div>
        <div className="mt-1 text-sm flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span>
            <span className="text-text-muted">Hours: </span>
            <HoursDisplay
              hours={props.hours}
              decimals={props.hoursDecimalPlaces ?? 2}
            />
          </span>
          <span>
            <span className="text-text-muted">Net: </span>
            <MoneyDisplay cents={props.roundedCents} monospace={false} />
          </span>
        </div>
      </div>
      {props.href && (
        <Button asChild variant="secondary" size="sm">
          <Link href={props.href}>Open</Link>
        </Button>
      )}
    </div>
  );
}
