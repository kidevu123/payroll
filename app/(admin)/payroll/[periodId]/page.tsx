import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/domain/status-pill";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { listRates } from "@/lib/db/queries/rate-history";
import { getSetting } from "@/lib/settings/runtime";
import { computePay } from "@/lib/payroll/computePay";
import { LockButtons } from "./lock-buttons";
import { db } from "@/lib/db";
import { taskPayLineItems } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export default async function PeriodReviewPage({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const { periodId } = await params;
  const period = await getPeriodById(periodId);
  if (!period) notFound();

  const [employees, punches, payRules, payPeriod] = await Promise.all([
    listEmployees(),
    listPunches({ periodId }),
    getSetting("payRules"),
    getSetting("payPeriod"),
  ]);

  // Group punches by employee.
  const punchesByEmployee = new Map<string, typeof punches>();
  for (const p of punches) {
    const list = punchesByEmployee.get(p.employeeId) ?? [];
    list.push(p);
    punchesByEmployee.set(p.employeeId, list);
  }

  // Pull task pay rows for this period in one shot.
  const tasks = await db
    .select()
    .from(taskPayLineItems)
    .where(eq(taskPayLineItems.periodId, periodId));
  const tasksByEmployee = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = tasksByEmployee.get(t.employeeId) ?? [];
    list.push(t);
    tasksByEmployee.set(t.employeeId, list);
  }

  // For rate-as-of-clockIn, fetch rate history per employee that overlaps period.
  const rows = await Promise.all(
    employees.map(async (e) => {
      const ePunches = punchesByEmployee.get(e.id) ?? [];
      const eTasks = tasksByEmployee.get(e.id) ?? [];
      if (ePunches.length === 0 && eTasks.length === 0) return null;
      const rates = await listRates(e.id);
      const result = computePay({
        punches: ePunches,
        rateAt: (p) => {
          const day = new Intl.DateTimeFormat("en-CA", {
            timeZone: "UTC",
          }).format(p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn));
          // First rate with effectiveFrom <= day. listRates returns desc.
          for (const r of rates) {
            if (r.effectiveFrom <= day) return r.hourlyRateCents;
          }
          return e.hourlyRateCents ?? 0;
        },
        taskPay: eTasks.map((t) => ({ amountCents: t.amountCents })),
        rules: {
          rounding: payRules.rounding,
          hoursDecimalPlaces: payRules.hoursDecimalPlaces,
          ...(payRules.overtime.enabled
            ? {
                overtime: {
                  thresholdHours: payRules.overtime.thresholdHours,
                  multiplier: payRules.overtime.multiplier,
                },
              }
            : {}),
        },
      });
      const incomplete = ePunches.filter((p) => !p.voidedAt && !p.clockOut).length;
      return { employee: e, result, incomplete };
    }),
  );
  const rendered = rows.filter((r): r is NonNullable<typeof r> => r !== null);

  const totals = rendered.reduce(
    (acc, r) => {
      acc.hours += r.result.totalHours;
      acc.gross += r.result.grossCents;
      acc.rounded += r.result.roundedCents;
      return acc;
    },
    { hours: 0, gross: 0, rounded: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/payroll">
            <ArrowLeft className="h-4 w-4" /> All periods
          </Link>
        </Button>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">
            {period.startDate} – {period.endDate}
          </h1>
          <StatusPill status={period.state} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-employee summary</CardTitle>
        </CardHeader>
        <CardContent>
          {rendered.length === 0 ? (
            <p className="text-sm text-[--text-muted]">
              No punches or task pay recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-[--text-muted]">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Employee</th>
                    <th className="py-2 px-3 font-medium text-right">Hours</th>
                    <th className="py-2 px-3 font-medium text-right">Gross</th>
                    <th className="py-2 px-3 font-medium text-right">Rounded</th>
                    <th className="py-2 px-3 font-medium text-right">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {rendered.map(({ employee, result, incomplete }) => (
                    <tr key={employee.id} className="border-t border-[--border]">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/employees/${employee.id}`}
                          className="hover:underline"
                        >
                          {employee.displayName}
                        </Link>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <HoursDisplay
                          hours={result.totalHours}
                          decimals={payRules.hoursDecimalPlaces}
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <MoneyDisplay cents={result.grossCents} />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <MoneyDisplay cents={result.roundedCents} />
                      </td>
                      <td className="py-2 px-3 text-right">
                        {incomplete > 0 ? (
                          <span className="text-amber-700">
                            {incomplete} incomplete
                          </span>
                        ) : (
                          <span className="text-[--text-muted]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm font-medium">
                  <tr className="border-t-2 border-[--border]">
                    <td className="py-2 pr-3">Totals</td>
                    <td className="py-2 px-3 text-right">
                      <HoursDisplay
                        hours={totals.hours}
                        decimals={payRules.hoursDecimalPlaces}
                      />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <MoneyDisplay cents={totals.gross} />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <MoneyDisplay cents={totals.rounded} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <LockButtons period={period} />

      <p className="text-xs text-[--text-muted]">
        Rounding: {payRules.rounding}. Period length: {payPeriod.lengthDays} days.
      </p>
    </div>
  );
}

// keep type-only re-export usage; not displayed.
export const dynamic = "force-dynamic";
