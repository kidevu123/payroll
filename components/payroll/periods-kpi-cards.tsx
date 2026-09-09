// KPI cards for /payroll, the same card treatment as /reports: tinted
// icon plate, label, figure, one line of real context.

import { AlertTriangle, Banknote, CalendarClock, Lock } from "lucide-react";
import Link from "next/link";
import { MoneyDisplay } from "@/components/domain/money-display";
import { formatHours } from "@/lib/utils";

function Card({
  label,
  tone,
  icon: Icon,
  value,
  context,
  href,
}: {
  label: string;
  tone: "brand" | "info" | "warning";
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  context: React.ReactNode;
  href?: string;
}) {
  const plate =
    tone === "brand"
      ? "bg-brand-50 text-brand-700"
      : tone === "info"
        ? "bg-info-50 text-info-700"
        : "bg-warning-50 text-warning-700";
  const body = (
    <>
      <span aria-hidden className={`mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-input ${plate}`}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <div className="text-sm text-text-muted">{label}</div>
        <div className="mt-0.5 truncate text-metric tabular-nums tracking-tight text-text">{value}</div>
        <div className="mt-1 text-caption text-text-subtle">{context}</div>
      </div>
    </>
  );
  const cls = "flex items-start gap-4 rounded-card border border-border/70 bg-surface px-5 py-4 shadow-card";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:bg-surface-2/40`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function PeriodsKpiCards({
  awaitingCount,
  awaitingCents,
  runningCount,
  runningHours,
  toProcessCount,
  incompletePunches,
}: {
  awaitingCount: number;
  awaitingCents: number;
  runningCount: number;
  runningHours: number;
  toProcessCount: number;
  incompletePunches: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        label="Awaiting payment"
        tone="brand"
        icon={Lock}
        value={awaitingCount}
        context={
          awaitingCount > 0 ? (
            <>
              <MoneyDisplay cents={awaitingCents} monospace={false} /> ready to pay
            </>
          ) : (
            "Nothing waiting on a payment"
          )
        }
      />
      <Card
        label="In progress"
        tone="info"
        icon={CalendarClock}
        value={runningCount}
        context={runningCount > 0 ? `${formatHours(runningHours)} hours so far` : "No period running"}
      />
      <Card
        label="Needs processing"
        tone={toProcessCount > 0 ? "warning" : "brand"}
        icon={Banknote}
        value={toProcessCount}
        context={toProcessCount > 0 ? "Ended, ready to review and lock" : "Nothing to review"}
      />
      <Card
        label="Incomplete punches"
        tone={incompletePunches > 0 ? "warning" : "info"}
        icon={AlertTriangle}
        value={incompletePunches}
        context={incompletePunches > 0 ? "Missing a clock-out · open Time to fix" : "Every shift closed"}
        href="/time"
      />
    </div>
  );
}
