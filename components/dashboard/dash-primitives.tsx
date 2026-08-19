// Shared dashboard presentational primitives. Pure, no data access.

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
          ? "0 0 0 1px rgba(52,211,153,0.12), 0 18px 50px -22px rgba(52,211,153,0.30)"
          : "0 10px 34px -24px rgba(0,0,0,0.7)",
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
        className={cn("text-[11px] font-medium", className)}
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
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
        className,
      )}
      style={{ color, background: bg }}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}
