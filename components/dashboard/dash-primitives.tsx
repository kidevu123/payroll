// Shared dashboard presentational primitives. Pure, no data access. These use
// the same radius and elevation language as the rest of the admin app so the
// dashboard feels like the product home, not a separate showcase surface.

import * as React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DASH } from "./theme";

/** Card surface used across the dashboard. */
export function DashCard({
  className,
  children,
  glow = false,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { glow?: boolean }) {
  return (
    <div
      className={cn(
        "relative rounded-card p-4",
        "transition-colors duration-200",
        className,
      )}
      style={{
        background: DASH.surface,
        border: `1px solid ${DASH.border}`,
        boxShadow: glow
          ? "0 1px 2px 0 rgb(15 23 42 / 0.06), 0 14px 30px -22px rgb(15 118 110 / 0.35)"
          : "0 1px 2px 0 rgb(15 23 42 / 0.05), 0 10px 24px -22px rgb(15 23 42 / 0.45)",
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Eyebrow / section label in muted zinc uppercase. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-xs font-semibold uppercase tracking-[0.1em]"
      style={{ color: DASH.textFaint }}
    >
      {children}
    </span>
  );
}

/** Green/red % delta chip. Positive renders emerald, negative rose. */
export function Delta({
  pct,
  className,
}: {
  pct: number | null;
  className?: string;
}) {
  if (pct === null) {
    return (
      <span
        className={cn("text-xs font-medium", className)}
        style={{ color: DASH.textFaint }}
      >
        —
      </span>
    );
  }
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const color = up ? DASH.emerald : DASH.rose;
  const bg = up ? "rgba(52,211,153,0.12)" : "rgba(251,113,133,0.12)";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        className,
      )}
      style={{ color, background: bg }}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
