// Designed empty state per §9 — Lucide icon in a tinted circle, helpful
// sentence, primary action. Never just "No data."
//
// The card sits on a soft dotted background so it reads as a deliberate
// composition, not a missing region. The icon defaults to a brand tint —
// pass `tone="neutral"` for muted contexts (sidebars, secondary cards).

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "brand" | "neutral";

const TONE_CLASSES: Record<Tone, { circle: string; icon: string }> = {
  brand: {
    circle: "bg-brand-50 ring-1 ring-inset ring-brand-100",
    icon: "text-brand-700",
  },
  neutral: {
    circle: "bg-surface-2 ring-1 ring-inset ring-border",
    icon: "text-text-muted",
  },
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  tone = "brand",
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const t = TONE_CLASSES[tone];
  return (
    <div
      className={cn(
        "relative overflow-hidden flex flex-col items-center justify-center text-center px-6 py-14 rounded-card border border-dashed border-border bg-surface",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--color-surface-2) 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      />
      <div
        className={cn(
          "relative flex h-14 w-14 items-center justify-center rounded-full",
          t.circle,
        )}
      >
        <Icon className={cn("h-6 w-6", t.icon)} aria-hidden />
      </div>
      <h3 className="relative mt-4 text-base font-semibold tracking-tight">
        {title}
      </h3>
      {description ? (
        <p className="relative mt-1.5 max-w-sm text-sm text-text-muted leading-relaxed">
          {description}
        </p>
      ) : null}
      {action ? <div className="relative mt-5">{action}</div> : null}
    </div>
  );
}
