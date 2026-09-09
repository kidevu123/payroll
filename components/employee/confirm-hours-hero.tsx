// "Confirm your hours" hero — the impossible-to-miss prompt that surfaces
// the previously-buried payslip acknowledgement.
//
// WHY THIS EXISTS: acknowledging a published payslip used to live only at
// the very bottom of /me/pay/[periodId], behind a three-card scroll. Only
// ~7 of 27 employees ever found it. This hero pulls that single action to
// the TOP of the page so it can't be missed.
//
// CONTRACT: renders ONLY when the employee has a published payslip awaiting
// their acknowledgement (not yet acknowledged, not currently disputed).
// Otherwise returns null, so it's safe to drop at the top of any employee
// page. Reuses the existing read (listPublishedPayslipsForEmployee) and the
// existing acknowledge server action (via the client ConfirmHoursActions).

import { Clock } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { listPublishedPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { getSetting } from "@/lib/settings/runtime";
import type { Payslip } from "@/lib/db/schema";
import { ConfirmHoursActions } from "@/app/(employee)/me/home/confirm-hours-actions";

/**
 * A published payslip is "awaiting acknowledgement" when it has not yet been
 * acknowledged AND is not sitting in an open dispute. Disputed payslips are
 * handled through the admin resolution flow, not a re-confirm prompt.
 */
function isAwaitingAck(p: Payslip): boolean {
  const isDisputed = !!p.disputedAt && !p.disputeResolvedAt;
  return !p.acknowledgedAt && !isDisputed;
}

export async function ConfirmHoursHero({
  employeeId,
}: {
  employeeId: string;
}) {
  const [payslips, payRules] = await Promise.all([
    listPublishedPayslipsForEmployee(employeeId),
    getSetting("payRules"),
  ]);

  // Most recent PERIOD awaiting acknowledgement first, then the next, so
  // confirming walks backwards through the weeks in order. (Sorting by
  // generatedAt jumped around on re-generated payslips.)
  const awaiting = payslips.filter(isAwaitingAck);
  const periodsById = new Map(
    (await Promise.all(awaiting.map((p) => getPeriodById(p.periodId))))
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((p) => [p.id, p]),
  );
  const pending = awaiting
    .filter((p) => periodsById.has(p.periodId))
    .sort((a, b) => {
      const as = periodsById.get(a.periodId)!.startDate;
      const bs = periodsById.get(b.periodId)!.startDate;
      return as < bs ? 1 : as > bs ? -1 : 0;
    });

  const top = pending[0];
  if (!top) return null;

  const period = periodsById.get(top.periodId);
  if (!period) return null;

  const t = await getTranslations("employee.pay");
  // The "Something's off" secondary routes to the payslip detail page where
  // the existing Report-a-problem dispute form lives.
  const disputeHref = `/me/pay/${top.periodId}`;

  return (
    <Card className="relative overflow-hidden border-brand-200/70 shadow-card-hover before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-brand-700">
      <CardContent className="space-y-5 px-6 py-6 sm:px-7 sm:py-7">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-chip bg-brand-50 ring-1 ring-inset ring-brand-100">
            <Clock className="h-4 w-4 text-brand-700" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-text antialiased">
              Confirm your hours
            </p>
            <p className="text-[11px] text-text-muted leading-relaxed">
              {period.startDate}{" "}
              <span className="text-text-subtle">–</span> {period.endDate}
              {pending.length > 1 ? (
                <span className="text-text-subtle"> · {pending.length - 1} more to confirm</span>
              ) : null}
            </p>
          </div>
        </div>

        {/* Net pay is the headline figure; hours sit alongside. */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-y border-border/60 py-4">
          <div className="min-w-0 space-y-1">
            <p className="text-micro uppercase text-text-subtle">
              {t("netPay")}
            </p>
            <p className="text-[1.75rem] sm:text-[2rem] font-semibold leading-[1.1] tracking-tight tabular-nums text-text antialiased">
              <MoneyDisplay cents={top.roundedPayCents} monospace={false} />
            </p>
          </div>
          <div className="space-y-1 text-right">
            <p className="text-micro uppercase text-text-subtle">
              {t("viewerHours")}
            </p>
            <p className="text-base font-semibold tracking-tight tabular-nums text-text antialiased">
              <HoursDisplay
                hours={Number(top.hoursWorked)}
                decimals={payRules.hoursDecimalPlaces}
                className="font-sans"
              />
            </p>
          </div>
        </div>

        <p className="text-xs text-text-muted leading-relaxed">
          Take a quick look — if your hours and pay look right, confirm below.
        </p>

        <ConfirmHoursActions
          key={top.id}
          payslipId={top.id}
          disputeHref={disputeHref}
          copy={{
            confirm: "Looks right — confirm",
            confirming: "Confirming…",
            somethingOff: "Something's off",
            confirmed: "Confirmed — thanks",
          }}
        />
      </CardContent>
    </Card>
  );
}
