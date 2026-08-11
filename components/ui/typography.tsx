// Typographic primitives.
//
// These exist because an audit found the type scale in globals.css was used
// by roughly 6% of sized text: 377 `text-xs`, 330 `text-sm` and 332 arbitrary
// `text-[Npx]` values against 9 `text-body` / 10 `text-caption`. The same
// uppercase label was written 32 different ways across 96 call sites, and KPI
// figures appeared at nine different sizes. Every element below has exactly
// one canonical form — reach for these instead of hand-rolling a size.

import * as React from "react";
import { cn } from "@/lib/utils";

type MicroLabelTone = "subtle" | "muted" | "brand" | "warning" | "danger" | "success";

const MICRO_TONE: Record<MicroLabelTone, string> = {
  subtle: "text-text-subtle",
  muted: "text-text-muted",
  brand: "text-brand-700",
  warning: "text-warning-700",
  danger: "text-danger-700",
  success: "text-success-700",
};

export type MicroLabelProps = React.HTMLAttributes<HTMLElement> & {
  /** Rendered element. Table headers should pass "th" via the table itself. */
  as?: "span" | "div" | "p";
  tone?: MicroLabelTone;
};

/**
 * Uppercase eyebrow / column header / stat caption. The one true micro label:
 * 10px, semibold, 0.12em tracking.
 */
export function MicroLabel({
  as: Tag = "span",
  tone = "subtle",
  className,
  ...props
}: MicroLabelProps) {
  return (
    <Tag
      className={cn(
        "text-micro uppercase antialiased",
        MICRO_TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

export type SectionTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  as?: "h2" | "h3" | "h4";
};

/**
 * Heading for a section inside a page or card. Matches CardTitle exactly, so
 * a card's title and a bare section head are the same size and weight.
 */
export function SectionTitle({
  as: Tag = "h2",
  className,
  ...props
}: SectionTitleProps) {
  return (
    <Tag
      className={cn(
        "text-subheading tracking-tight antialiased text-text",
        className,
      )}
      {...props}
    />
  );
}

export type StatValueProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Slightly smaller figure for dense tiles and rail rows. */
  size?: "default" | "sm";
};

/** KPI / hero figure. Always tabular so columns of numbers line up. */
export function StatValue({
  size = "default",
  className,
  ...props
}: StatValueProps) {
  return (
    <div
      className={cn(
        "tabular-nums antialiased text-text",
        size === "sm"
          ? "text-subheading font-semibold tracking-tight"
          : "text-metric",
        className,
      )}
      {...props}
    />
  );
}
