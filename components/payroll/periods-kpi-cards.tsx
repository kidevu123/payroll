// KPI cards for /payroll, the same card treatment as /reports: tinted
// icon plate, label, figure, one line of real context.

import { AlertTriangle, Banknote, CalendarClock, Lock } from "lucide-react";
import { MoneyDisplay } from "@/components/domain/money-display";
import { formatHours } from "@/lib/utils";
import { KpiCard } from "@/components/ui/kpi-card";

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
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-4">
      <KpiCard
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
      <KpiCard
        label="In progress"
        tone="info"
        icon={CalendarClock}
        value={runningCount}
        context={runningCount > 0 ? `${formatHours(runningHours)} hours so far` : "No period running"}
      />
      <KpiCard
        label="Needs processing"
        tone={toProcessCount > 0 ? "warning" : "brand"}
        icon={Banknote}
        value={toProcessCount}
        context={toProcessCount > 0 ? "Ended, ready to review and lock" : "Nothing to review"}
      />
      <KpiCard
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
