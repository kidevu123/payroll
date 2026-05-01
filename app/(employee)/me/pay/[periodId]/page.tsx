// Employee payslip viewer. Three-card layout:
//   1. Summary  — hours / gross / net for the period
//   2. Daily    — date | in | out | hours | est. pay per row
//   3. Original — download the legacy report file (only when one exists)
// Plus an Acknowledge button when not yet acknowledged.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MoneyDisplay } from "@/components/domain/money-display";
import { HoursDisplay } from "@/components/domain/hours-display";
import { requireSession } from "@/lib/auth-guards";
import { dedupNearDuplicatePunches } from "@/lib/punches/dedup";
import { getPublishedPayslipForEmployeePeriod } from "@/lib/db/queries/payslips";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { getEmployee } from "@/lib/db/queries/employees";
import { listPunches } from "@/lib/db/queries/punches";
import { getSetting } from "@/lib/settings/runtime";
import { AcknowledgeButton } from "./acknowledge-button";

const MS_PER_HOUR = 60 * 60 * 1000;

function fmtTime(d: Date | null, tz: string): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

function fmtDayLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  }).format(new Date(`${iso}T12:00:00Z`));
}

export default async function EmployeePayslipViewer({
  params,
}: {
  params: Promise<{ periodId: string }>;
}) {
  const session = await requireSession();
  const { periodId } = await params;
  const period = await getPeriodById(periodId);
  if (!period) notFound();
  if (!session.user.employeeId) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <p className="text-sm text-text-muted">
          Your account is not linked to an employee record.
        </p>
      </div>
    );
  }
  const [payslip, payRules, company, employee] = await Promise.all([
    getPublishedPayslipForEmployeePeriod(session.user.employeeId, periodId),
    getSetting("payRules"),
    getSetting("company"),
    getEmployee(session.user.employeeId),
  ]);
  const tz = company.timezone ?? "America/New_York";

  return (
    <div className="space-y-4 p-4 max-w-3xl mx-auto">
      <Button asChild variant="ghost" size="sm">
        <Link href="/me/pay">
          <ArrowLeft className="h-4 w-4" /> All payslips
        </Link>
      </Button>

      {!payslip ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {period.startDate} – {period.endDate}
            </CardTitle>
            <CardDescription>No payslip yet for this period.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-text-muted">
              When the run publishes, your payslip lands here automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <PayslipBody
          payslip={payslip}
          period={period}
          payRules={payRules}
          tz={tz}
          rateCents={employee?.hourlyRateCents ?? null}
          payType={employee?.payType ?? "HOURLY"}
        />
      )}
    </div>
  );
}

async function PayslipBody({
  payslip,
  period,
  payRules,
  tz,
  rateCents,
  payType,
}: {
  payslip: NonNullable<Awaited<ReturnType<typeof getPublishedPayslipForEmployeePeriod>>>;
  period: NonNullable<Awaited<ReturnType<typeof getPeriodById>>>;
  payRules: Awaited<ReturnType<typeof getSetting<"payRules">>>;
  tz: string;
  rateCents: number | null;
  payType: "HOURLY" | "FLAT_TASK" | "SALARIED";
}) {
  // Pull every punch the employee has and filter by date range against the
  // employee's display tz — covers cases where punches are stored on a
  // different period_id than the one the payslip is pinned to (e.g. legacy
  // imports where weekly periods bracket the actual report range).
  const all = await listPunches({ employeeId: payslip.employeeId });
  const start = period.startDate;
  const end = period.endDate;
  const inRange = all.filter((p) => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn),
    );
    return day >= start && day <= end && !p.voidedAt;
  });

  // Group by day in employee tz.
  const byDay = new Map<string, typeof inRange>();
  for (const p of inRange) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(
      p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn),
    );
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  const days = Array.from(byDay.keys()).sort();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {period.startDate} – {period.endDate}
          </CardTitle>
          <CardDescription>
            {payslip.acknowledgedAt
              ? `Acknowledged ${payslip.acknowledgedAt.toISOString().slice(0, 16).replace("T", " ")}`
              : "Published — please review and acknowledge."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <Stat label="Hours">
            <HoursDisplay
              hours={Number(payslip.hoursWorked)}
              decimals={payRules.hoursDecimalPlaces}
            />
          </Stat>
          <Stat label="Gross">
            <MoneyDisplay cents={payslip.grossPayCents} monospace={false} />
          </Stat>
          <Stat label="Net (rounded)">
            <MoneyDisplay cents={payslip.roundedPayCents} monospace={false} />
          </Stat>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily breakdown</CardTitle>
          <CardDescription>
            Times shown in your local timezone ({tz.replace("_", " ")}).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {days.length === 0 ? (
            <p className="text-sm text-text-muted">
              No clock-in records on file for this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Day</th>
                    <th className="py-2 px-3 font-medium">In</th>
                    <th className="py-2 px-3 font-medium">Out</th>
                    <th className="py-2 px-3 font-medium text-right">Hours</th>
                    {payType === "HOURLY" && (
                      <th className="py-2 px-3 font-medium text-right">Est. pay</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {days.flatMap((d) => {
                    const list = dedupNearDuplicatePunches(
                      byDay
                        .get(d)!
                        .slice()
                        .sort((a, b) => {
                          const ai = a.clockIn instanceof Date ? a.clockIn : new Date(a.clockIn);
                          const bi = b.clockIn instanceof Date ? b.clockIn : new Date(b.clockIn);
                          return ai.getTime() - bi.getTime();
                        }),
                    );
                    return list.map((p, i) => {
                      const inT = p.clockIn instanceof Date ? p.clockIn : new Date(p.clockIn);
                      const outT = p.clockOut
                        ? p.clockOut instanceof Date
                          ? p.clockOut
                          : new Date(p.clockOut)
                        : null;
                      const hours = outT
                        ? (outT.getTime() - inT.getTime()) / MS_PER_HOUR
                        : null;
                      const estCents =
                        hours !== null && rateCents !== null && payType === "HOURLY"
                          ? Math.round(hours * rateCents)
                          : null;
                      return (
                        <tr key={p.id} className="hover:bg-surface-2/30">
                          <td className="py-1.5 pr-3 text-text-muted">
                            {i === 0 ? fmtDayLabel(d, tz) : ""}
                          </td>
                          <td className="py-1.5 px-3 font-mono">{fmtTime(inT, tz)}</td>
                          <td className="py-1.5 px-3 font-mono">{fmtTime(outT, tz)}</td>
                          <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                            {hours !== null ? hours.toFixed(2) : "—"}
                          </td>
                          {payType === "HOURLY" && (
                            <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                              {estCents !== null ? (
                                <MoneyDisplay cents={estCents} monospace={false} />
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-text-muted">
            &quot;Est. pay&quot; is rate × hours per day before the period
            rounding rule (currently{" "}
            {payRules.rounding.toLowerCase().replace(/_/g, " ")}). Your final
            paycheck is the rounded total above.
          </p>
        </CardContent>
      </Card>

      {payslip.pdfPath && payslip.pdfPath.toLowerCase().endsWith(".pdf") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Printable payslip</CardTitle>
          </CardHeader>
          <CardContent>
            <iframe
              title={`Payslip ${period.startDate}`}
              src={`/api/payslips/${payslip.id}/pdf`}
              className="w-full h-[70vh] rounded-card border border-border bg-surface"
            />
          </CardContent>
        </Card>
      ) : payslip.pdfPath ? (
        <Card>
          <CardContent className="p-6 space-y-3 text-sm">
            <p className="text-text-muted">
              An original spreadsheet is attached for this period.
            </p>
            <Button asChild variant="secondary">
              <a href={`/api/payslips/${payslip.id}/pdf`} download>
                <FileDown className="h-4 w-4" /> Download original report
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {!payslip.acknowledgedAt && <AcknowledgeButton payslipId={payslip.id} />}
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="font-semibold text-base">{children}</div>
    </div>
  );
}

