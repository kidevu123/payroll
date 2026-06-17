// Second-row + KPI presentational cards for the dark dashboard. Pure
// presentational; all data pre-shaped by computeDashboardMetrics.

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { SpendTrendChart } from "./charts/spend-trend-chart";
import { SyncSparkline } from "./charts/sync-sparkline";
import { HealthGauge } from "./charts/health-gauge";
import { DashCard, Delta, Eyebrow } from "./dash-primitives";
import { DashboardPollButton } from "./dashboard-poll-button";
import { DASH } from "./theme";
import type {
  DashboardMetrics,
  HealthChecklistItem,
} from "@/lib/payroll/dashboard-metrics";

/** "$1.24M" / "$842K" / "$1,200" compact money for hero figures. */
function compactMoney(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (dollars >= 10_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return formatMoney(cents);
}

function relativeAge(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function TrendCard({ trend }: { trend: DashboardMetrics["trend"] }) {
  return (
    <DashCard className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Eyebrow>Pay spend trend</Eyebrow>
          <div className="mt-1.5 flex items-end gap-2.5">
            <span
              className="text-[1.8rem] font-bold leading-none tracking-[-0.02em] tabular-nums"
              style={{ color: DASH.text }}
            >
              {compactMoney(trend.ytdCents)}
            </span>
            <Delta pct={trend.deltaPct} className="mb-1.5" />
          </div>
          <div className="mt-1 text-[11px]" style={{ color: DASH.textFaint }}>
            Year-to-date payroll spend
          </div>
        </div>
        <span
          className="hidden h-9 w-9 items-center justify-center rounded-xl sm:flex"
          style={{ background: "rgba(139,92,246,0.12)", border: `1px solid ${DASH.border}` }}
        >
          <Activity className="h-4 w-4" style={{ color: DASH.violetBright }} />
        </span>
      </div>
      <SpendTrendChart data={trend.points} />
    </DashCard>
  );
}

function MiniStat({
  eyebrow,
  value,
  icon: Icon,
  accent,
  sub,
}: {
  eyebrow: string;
  value: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent: string;
  sub?: React.ReactNode;
}) {
  return (
    <DashCard className="flex h-full flex-col justify-between gap-2">
      <div className="flex items-start justify-between">
        <Eyebrow>{eyebrow}</Eyebrow>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${DASH.border}` }}
        >
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </span>
      </div>
      <div>
        <div
          className="text-[1.3rem] font-bold leading-none tabular-nums"
          style={{ color: DASH.text }}
        >
          {value}
        </div>
        {sub ? <div className="mt-1.5">{sub}</div> : null}
      </div>
    </DashCard>
  );
}

export function HeadcountCard({
  count,
  delta = null,
}: {
  count: number;
  delta?: number | null;
}) {
  return (
    <MiniStat
      eyebrow="Headcount"
      value={String(count)}
      icon={Users}
      accent={DASH.violetBright}
      sub={
        <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: DASH.textFaint }}>
          Active employees
          {delta !== null && delta !== 0 ? (
            <span
              className="font-semibold tabular-nums"
              style={{ color: delta > 0 ? DASH.emerald : DASH.rose }}
            >
              {delta > 0 ? "+" : ""}
              {delta}
            </span>
          ) : null}
        </span>
      }
    />
  );
}

export function ExceptionsCard({ count }: { count: number }) {
  const clear = count === 0;
  return (
    <MiniStat
      eyebrow="Exceptions"
      value={String(count)}
      icon={clear ? CheckCircle2 : TriangleAlert}
      accent={clear ? DASH.emerald : DASH.amber}
      sub={
        <span
          className="inline-flex items-center gap-1 text-[11px]"
          style={{ color: clear ? DASH.emerald : DASH.amber }}
        >
          {clear ? (
            <>
              <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> All resolved
            </>
          ) : (
            "Unresolved alerts"
          )}
        </span>
      }
    />
  );
}

export function SyncCard({ sync }: { sync: DashboardMetrics["sync"] }) {
  const stable = sync.state === "STABLE";
  const accent = stable ? DASH.emerald : DASH.amber;
  const StateIcon = stable ? Wifi : WifiOff;
  const label =
    sync.state === "STABLE"
      ? "Stable"
      : sync.state === "STALE"
        ? "Stale"
        : "Unknown";
  return (
    <DashCard className="flex h-full flex-col justify-between gap-2">
      <div className="flex items-start justify-between">
        <Eyebrow>NGTeco sync</Eyebrow>
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: accent, background: `${accent}1f` }}
        >
          <StateIcon className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
      </div>
      <div>
        <div className="text-sm font-semibold" style={{ color: DASH.text }}>
          Last sync {relativeAge(sync.lastSyncAt)}
        </div>
        <div className="mt-2">
          <SyncSparkline data={sync.points} />
        </div>
      </div>
    </DashCard>
  );
}

function healthLabel(score: number): { word: string; caption: string } {
  if (score >= 90) return { word: "Excellent", caption: "Everything looks great!" };
  if (score >= 75) return { word: "Good", caption: "Healthy with minor items." };
  if (score >= 50) return { word: "Fair", caption: "A few things need attention." };
  return { word: "Needs attention", caption: "Several items to resolve." };
}

export function HealthCard({ health }: { health: DashboardMetrics["health"] }) {
  const { word, caption } = healthLabel(health.score);
  return (
    <DashCard glow className="flex h-full flex-col gap-3">
      <Eyebrow>Payroll health score</Eyebrow>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <div className="flex w-28 flex-col items-center">
          <HealthGauge score={health.score} />
          <div className="-mt-1 text-[12px] font-semibold" style={{ color: DASH.emerald }}>
            {word}
          </div>
        </div>
        <ul className="space-y-1">
          {health.checklist.map((item: HealthChecklistItem) => (
            <li
              key={item.key}
              className="flex items-center gap-2 text-[11px]"
              style={{ color: item.ok ? DASH.textMuted : DASH.textFaint }}
            >
              {item.ok ? (
                <CheckCircle2
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: DASH.emerald }}
                  aria-hidden="true"
                />
              ) : (
                <TriangleAlert
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: DASH.amber }}
                  aria-hidden="true"
                />
              )}
              {item.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="text-[11px]" style={{ color: DASH.textFaint }}>
        {caption}
      </div>
    </DashCard>
  );
}

export function AutomationBanner({
  automation,
}: {
  automation: DashboardMetrics["automation"];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
      <DashCard
        glow
        className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{
              background: "rgba(139,92,246,0.16)",
              border: `1px solid ${DASH.borderStrong}`,
            }}
          >
            <Sparkles className="h-5 w-5" style={{ color: DASH.violetBright }} />
          </span>
          <div>
            <div className="text-sm font-semibold" style={{ color: DASH.text }}>
              Automate more. Save more time.
            </div>
            <div className="text-[12px]" style={{ color: DASH.textMuted }}>
              Sync punches from NGTeco and auto-apply rules to eliminate manual work.
            </div>
          </div>
        </div>
        <DashboardPollButton />
      </DashCard>

      <div className="grid grid-cols-2 gap-4 lg:w-72">
        <MiniStat
          eyebrow="Runs this month"
          value={String(automation.runsThisMonth)}
          icon={RefreshCw}
          accent={DASH.violetBright}
        />
        <MiniStat
          eyebrow="Open periods"
          value={String(automation.openPeriods)}
          icon={Activity}
          accent={DASH.emerald}
        />
      </div>
    </div>
  );
}

export function KpiBar({ kpis }: { kpis: DashboardMetrics["kpis"] }) {
  const tiles: Array<{
    label: string;
    value: string;
    sub: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    accent: string;
  }> = [
    {
      label: "Total payroll spend (YTD)",
      value: compactMoney(kpis.ytdSpendCents),
      sub: "This calendar year",
      icon: Activity,
      accent: DASH.violetBright,
    },
    {
      label: "Cost per employee",
      value: kpis.costPerEmployeeCents !== null ? compactMoney(kpis.costPerEmployeeCents) : "—",
      sub: "YTD ÷ active headcount",
      icon: Wallet,
      accent: DASH.emerald,
    },
    {
      label: "Payroll runs this month",
      value: String(kpis.runsThisMonth),
      sub: "Approved or published",
      icon: RefreshCw,
      accent: DASH.violetBright,
    },
    {
      label: "Active employees",
      value: String(kpis.activeEmployees),
      sub: "Currently on payroll",
      icon: Users,
      accent: DASH.emerald,
    },
    {
      label: "Projected spend (next 4 weeks)",
      value: compactMoney(kpis.projectedSpendCents),
      sub: "Estimate from YTD run-rate",
      icon: TrendingUp,
      accent: DASH.violetBright,
    },
  ];

  return (
    <DashCard className="grid grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div key={t.label} className="flex items-center gap-2.5">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${DASH.border}` }}
            >
              <Icon className="h-[17px] w-[17px]" style={{ color: t.accent }} />
            </span>
            <div className="min-w-0">
              <div
                className="truncate text-[10px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: DASH.textFaint }}
              >
                {t.label}
              </div>
              <div
                className="text-lg font-bold leading-tight tabular-nums"
                style={{ color: DASH.text }}
              >
                {t.value}
              </div>
              <div className="truncate text-[10px]" style={{ color: DASH.textFaint }}>
                {t.sub}
              </div>
            </div>
          </div>
        );
      })}
    </DashCard>
  );
}
