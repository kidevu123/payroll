// Rail card: a one-line read on overtime risk.
import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

export function MiloInsightCard({ overtimeRisk }: { overtimeRisk: number }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-brand-700" />
        <h3 className="text-sm font-semibold">Milo insight</h3>
        <span
          className="rounded px-1 text-micro uppercase"
          style={{
            background: "color-mix(in srgb, var(--dash-cyan) 18%, transparent)",
            color: "var(--dash-cyan)",
          }}
        >
          Beta
        </span>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {overtimeRisk > 0
          ? `${overtimeRisk} team member${overtimeRisk === 1 ? "" : "s"} approaching overtime this period. Consider adjusting shifts or approving overtime.`
          : "No overtime risk this period — labor is tracking on plan."}
      </p>
      {overtimeRisk > 0 && (
        <Link
          href="/time"
          className="mt-2.5 inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-input border border-border py-1.5 text-xs font-semibold text-brand-700 transition-colors hover:bg-surface-2/40"
        >
          Review overtime risk <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
