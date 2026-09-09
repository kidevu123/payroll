// Year-to-date figures as one quiet strip under the page title. Replaces
// four boxed KPI cards (icon plate + label + value + "Year to date" each)
// that took 120px of height to say four numbers, plus a rail "Summary"
// card that repeated them. Text only: label above, figure below, hairline
// between stats.

import { MoneyDisplay } from "@/components/domain/money-display";
import type { ReportsOverview } from "@/lib/reports/reports-overview";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-micro uppercase text-text-subtle">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums tracking-tight text-text">
        {children}
      </div>
    </div>
  );
}

export function ReportsStatStrip({ ytd }: { ytd: ReportsOverview["ytd"] }) {
  const year = new Date().getUTCFullYear();
  return (
    <div className="flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-8">
      <div className="text-sm text-text-muted">{year} to date</div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:flex sm:divide-x sm:divide-border/60 [&>*+*]:sm:pl-8">
        <Stat label="Gross pay">
          <MoneyDisplay cents={ytd.totalGrossCents} monospace={false} />
        </Stat>
        <Stat label="Net pay">
          <MoneyDisplay cents={ytd.totalNetCents} monospace={false} />
        </Stat>
        <Stat label="Pay runs">{ytd.totalReports}</Stat>
        <Stat label="Employees paid">{ytd.employeesPaid}</Stat>
      </div>
    </div>
  );
}
