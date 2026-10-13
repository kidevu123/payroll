// The first thing on a period page when a shift was never closed: who, which
// day, when they clocked in, and a button that opens that day's editor.
//
// It reads the period's punches directly instead of the employee totals
// table. The table only lists employees on the period's pay schedule (and,
// once the period is locked, only those with a payslip), so an open punch
// from anyone else was counted on the Pay Periods list as "1 incomplete
// punch" and then appeared nowhere on this page.
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeletePunchButton } from "@/components/domain/delete-punch-button";
import {
  incompletePunchFixHref,
  type IncompletePunch,
} from "@/lib/payroll/incomplete-punches";

function dayLabel(dayIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dayIso}T12:00:00Z`));
}

function clockLabel(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(at);
}

export function IncompletePunchesBanner({
  periodId,
  punches,
  timezone,
  canFix,
}: {
  periodId: string;
  punches: IncompletePunch[];
  timezone: string;
  /** Read-only roles see the list without the Fix button. */
  canFix: boolean;
}) {
  if (punches.length === 0) return null;
  const n = punches.length;
  return (
    <section
      id="incomplete-punches"
      aria-labelledby="incomplete-punches-title"
      className="scroll-mt-4 overflow-hidden rounded-card border border-warning-500/50 bg-surface shadow-card"
    >
      <header className="flex items-start gap-3 border-b border-l-4 border-b-border/60 border-l-warning-500 bg-warning-500/10 px-5 py-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-600" aria-hidden />
        <div>
          <h2 id="incomplete-punches-title" className="text-subheading tracking-tight text-text">
            {n} incomplete punch{n === 1 ? "" : "es"}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Clocked in and never clocked out, so {n === 1 ? "this shift counts" : "these shifts count"} as
            zero hours. Add the clock-out if it was a real shift, or delete the punch if it was not.
          </p>
        </div>
      </header>
      <ul className="divide-y divide-border/60">
        {punches.map((p) => (
          <li
            key={p.punchId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text">{p.employeeName}</p>
              <p className="text-xs tabular-nums text-text-muted">
                {dayLabel(p.day)} · clocked in {clockLabel(p.clockIn, timezone)} · no clock-out
              </p>
            </div>
            {canFix ? (
              // Fix = it was a real shift, add the clock-out. Delete = it was
              // not a shift at all (walked past the clock).
              <div className="flex flex-wrap items-center justify-end gap-2">
                <DeletePunchButton
                  punchId={p.punchId}
                  describe={`${p.employeeName}, ${dayLabel(p.day)}, ${clockLabel(p.clockIn, timezone)}.`}
                  label="Delete punch"
                />
                <Button asChild size="sm">
                  <Link href={incompletePunchFixHref(periodId, p)}>
                    Fix this punch <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
