// The chip beside the /time title: is the period on screen open, locked,
// paid, or a not-yet-created upcoming window.
import type { PeriodView } from "@/lib/time-grid/period-select";

const BADGE: Record<PeriodView["state"], { label: string; cls: string }> = {
  UPCOMING: { label: "Upcoming", cls: "bg-brand-50 text-brand-700 border-brand-200/80" },
  LOCKED: { label: "Locked", cls: "bg-warning-50 text-warning-700 border-warning-200/80" },
  PAID: { label: "Paid", cls: "bg-success-50 text-success-700 border-success-200/80" },
  OPEN: { label: "Open", cls: "bg-success-50 text-success-700 border-success-200/80" },
};

export function PeriodStateBadge({ state }: { state: PeriodView["state"] }) {
  const badge = BADGE[state];
  return (
    <span
      className={`inline-flex items-center rounded-chip border px-2 py-0.5 text-caption font-semibold uppercase tracking-wider ${badge.cls}`}
    >
      {badge.label}
    </span>
  );
}
