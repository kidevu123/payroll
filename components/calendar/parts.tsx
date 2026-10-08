// Small pieces of the admin calendar: a day-cell entry, a tab pill, a legend
// chip and an overview stat tile.
import Link from "next/link";
import {
  CancelTimeOffActionButton,
  EditApprovedTimeOffAction,
} from "@/app/(admin)/requests/request-actions";
import { TYPE_COLORS, TYPE_LABEL } from "@/lib/time/calendar-grid";

export function CalendarEntry({
  entry,
  compact = false,
}: {
  entry: {
    id: string;
    type: string;
    emp: string;
    startDate: string;
    endDate: string;
    reason: string | null;
    partial: string | null;
    pending: boolean;
    manageable: boolean;
  };
  compact?: boolean;
}) {
  const chipClassName =
    (compact ? "text-[10px]" : "text-[11px]") +
    " block w-full truncate rounded border px-1.5 py-0.5 text-left leading-tight " +
    (TYPE_COLORS[entry.type] ?? TYPE_COLORS.OTHER) +
    (entry.pending ? " border-dashed opacity-70" : "");
  const label = entry.partial ? `${entry.emp} · ${entry.partial}` : entry.emp;
  const title = `${entry.emp} — ${TYPE_LABEL[entry.type] ?? entry.type}${entry.partial ? ` ${entry.partial}` : ""}${entry.pending ? " (pending)" : ""}`;

  if (!entry.manageable) {
    return (
      <div className={chipClassName} title={title}>
        {label}
      </div>
    );
  }

  return (
    <details className="group relative">
      <summary className="list-none cursor-pointer" title={`${title} — click to edit or cancel`}>
        <span className={chipClassName}>{label}</span>
      </summary>
      <div className="absolute left-0 top-full z-20 mt-1 w-64 space-y-2 rounded-card border border-border bg-surface p-2 shadow-pop">
        <div className="text-[11px] font-medium text-text">{entry.emp}</div>
        <div className="text-[10px] text-text-muted tabular-nums">
          {entry.startDate}
          {entry.startDate !== entry.endDate ? ` – ${entry.endDate}` : ""}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1">
          <EditApprovedTimeOffAction
            request={{
              id: entry.id,
              startDate: entry.startDate,
              endDate: entry.endDate,
              type: entry.type as "UNPAID" | "SICK" | "PERSONAL" | "OTHER",
              reason: entry.reason,
            }}
          />
          <CancelTimeOffActionButton requestId={entry.id} status="APPROVED" />
        </div>
      </div>
    </details>
  );
}

export function TabPill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`-mb-px inline-flex items-center border-b-2 px-3 py-2 text-sm font-medium transition-colors [@media(pointer:coarse)]:min-h-11 ${
        active
          ? "border-brand-700 text-text"
          : "border-transparent text-text-muted hover:text-text"
      }`}
    >
      {label}
    </Link>
  );
}

export function Legend({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${className}`}>
      {label}
    </span>
  );
}

// Overview stat tile for the calendar rail. Uses the dash palette tokens
// (defined light + dark in globals.css) so each tile stays a distinct,
// correctly-tinted color in BOTH themes — unlike brand-50, which is
// deliberately pale in dark mode. color-mix over transparent gives a soft
// tint that works on both the white (light) and near-black (dark) card.
// Mobile dot color per time-off type (matches the #69 dot-grid + legend).
export const TYPE_DOT: Record<string, string> = {
  PERSONAL: "var(--dash-emerald)",
  SICK: "var(--dash-amber)",
  UNPAID: "var(--dash-text-faint)",
  OTHER: "var(--dash-cyan)",
  SCHEDULE_NOTE: "var(--dash-blue)",
};

export const OVERVIEW_TONE: Record<string, string> = {
  emerald: "var(--dash-emerald)",
  amber: "var(--dash-amber)",
  cyan: "var(--dash-cyan)",
  blue: "var(--dash-blue)",
};

export function OverviewStat({
  tone,
  value,
  label,
  sub,
}: {
  tone: "emerald" | "amber" | "cyan" | "blue";
  value: string | number;
  label: string;
  sub: string;
}) {
  const c = OVERVIEW_TONE[tone];
  return (
    <div
      className="rounded-input p-3"
      style={{ background: `color-mix(in srgb, ${c} 14%, transparent)` }}
    >
      <div className="text-2xl font-bold leading-none tabular-nums" style={{ color: c }}>
        {value}
      </div>
      <div className="mt-1.5 text-xs font-semibold text-text">{label}</div>
      <div className="text-[11px] text-text-muted">{sub}</div>
    </div>
  );
}
