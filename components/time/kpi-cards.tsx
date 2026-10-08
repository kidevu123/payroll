// The five attendance figures across the top of /time.
import { AlertTriangle, CalendarX2, Clock, TimerReset, Users, type LucideIcon } from "lucide-react";
import { fmtHm, type GridKpis } from "@/lib/time-grid/kpis";

const KPI_TONE: Record<string, string> = {
  emerald: "var(--dash-emerald)",
  blue: "var(--dash-blue)",
  amber: "var(--dash-amber)",
  cyan: "var(--dash-cyan)",
  rose: "var(--dash-rose)",
};

function KpiCard({
  icon: Icon,
  tone,
  value,
  label,
  sub,
  wide = false,
}: {
  icon: LucideIcon;
  tone: keyof typeof KPI_TONE;
  value: string | number;
  label: string;
  sub: string;
  /** Spans both columns of the phone grid (icon beside the figure) so five
   *  cards tile 1 + 2 + 2 instead of leaving an orphan in the last row. */
  wide?: boolean;
}) {
  const c = KPI_TONE[tone];
  return (
    <div
      // Phone: the icon plate tucks into the top-right corner so the figure
      // leads and each card is ~80px instead of ~150px — five stacked plates
      // pushed the roster a full screen down.
      className={`relative rounded-card border border-border bg-surface p-3 shadow-card ${
        wide ? "max-sm:col-span-2" : ""
      }`}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg max-sm:absolute max-sm:right-3 max-sm:top-3 max-sm:h-7 max-sm:w-7"
        style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div
          className="mt-2 text-xl font-bold leading-tight tabular-nums tracking-tight text-text max-sm:mt-0 max-sm:pr-9"
        >
          {value}
        </div>
        <div className="truncate text-[12px] font-medium text-text-muted">{label}</div>
        <div className="truncate text-[11px] font-medium" style={{ color: c }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

export function KpiCards({ kpis, dayCount }: { kpis: GridKpis; dayCount: number }) {
  return (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5">
    <KpiCard wide icon={Clock} tone="emerald" value={fmtHm(kpis.totalMinutes)} label="Total hours" sub={`${dayCount}-day period`} />
    <KpiCard icon={Users} tone="blue" value={`${kpis.clockedInToday} / ${kpis.teamSize}`} label="Employees clocked in" sub={`${kpis.teamPct}% of team`} />
    <KpiCard icon={AlertTriangle} tone="amber" value={kpis.staleOpenPunchCount} label="Missing punches" sub={kpis.staleOpenPunchCount > 0 ? "Needs attention" : "All clear"} />
    <KpiCard icon={CalendarX2} tone="cyan" value={kpis.openNow} label="Open shifts" sub="In progress now" />
    <KpiCard icon={TimerReset} tone="rose" value={kpis.overtimeRisk} label="Overtime risk" sub={kpis.overtimeRisk > 0 ? "Review needed" : "On track"} />
  </div>
  );
}
