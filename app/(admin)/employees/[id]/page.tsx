import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/domain/status-pill";
import { ShiftChip } from "@/components/domain/shift-chip";
import { MoneyDisplay } from "@/components/domain/money-display";
import { RateHistoryList } from "@/components/domain/rate-history-list";
import { PunchRow } from "@/components/domain/punch-row";
import { getEmployee } from "@/lib/db/queries/employees";
import { listShifts } from "@/lib/db/queries/shifts";
import { listRates } from "@/lib/db/queries/rate-history";
import { listPunches } from "@/lib/db/queries/punches";
import { listSchedules } from "@/lib/db/queries/pay-schedules";
import { findUserByEmployeeId } from "@/lib/db/queries/users";
import { listPayslipsForEmployee } from "@/lib/db/queries/payslips";
import { getPeriodById } from "@/lib/db/queries/pay-periods";
import { listEmployeeVisibleDocs } from "@/lib/db/queries/payroll-documents";
import { getSetting } from "@/lib/settings/runtime";
import { Download, FileText } from "lucide-react";
import { ArchiveEmployeeButton } from "./archive-button";
import { AccountSection } from "./account-section";
import { RecomputePayslipsButton } from "./recompute-button";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) notFound();

  const [allShifts, rates, recentPunches, company, schedules, account, payslips, payrollDocs] = await Promise.all([
    listShifts({ includeArchived: true }),
    listRates(employee.id),
    listPunches({ employeeId: employee.id, includeVoided: false }),
    getSetting("company"),
    listSchedules({ includeInactive: true }),
    findUserByEmployeeId(employee.id),
    listPayslipsForEmployee(employee.id),
    listEmployeeVisibleDocs(employee.id),
  ]);
  // Resolve period dates for each payslip — small handful per employee.
  const payslipsWithPeriods = await Promise.all(
    payslips.map(async (p) => {
      const period = await getPeriodById(p.periodId);
      return { payslip: p, period };
    }),
  );
  payslipsWithPeriods.sort((a, b) => {
    const aDate = a.period?.endDate ?? "";
    const bDate = b.period?.endDate ?? "";
    return bDate.localeCompare(aDate);
  });
  const shift = employee.shiftId ? allShifts.find((s) => s.id === employee.shiftId) : null;
  const schedule = employee.payScheduleId
    ? schedules.find((s) => s.id === employee.payScheduleId)
    : null;
  const lastTen = recentPunches.slice(-10).reverse();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/employees">
              <ArrowLeft className="h-4 w-4" /> All employees
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold mt-2 flex items-center gap-2">
            {employee.displayName}
            <StatusPill status={employee.status} />
          </h1>
          {employee.legalName !== employee.displayName && (
            <p className="text-sm text-text-muted">Legal: {employee.legalName}</p>
          )}
          <p className="text-sm text-text-muted">{employee.email}</p>
        </div>
        <div className="flex items-center gap-2">
          {shift ? <ShiftChip name={shift.name} colorHex={shift.colorHex} archived={!!shift.archivedAt} /> : null}
          <Button asChild variant="secondary" size="sm">
            <Link href={`/employees/${employee.id}/edit`}>
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Field label="Phone" value={employee.phone ?? "—"} />
            <Field label="Hired on" value={employee.hiredOn} />
            <Field
              label="Pay type"
              value={
                employee.payType === "HOURLY"
                  ? "Hourly"
                  : employee.payType === "FLAT_TASK"
                    ? "Flat / task"
                    : "Salaried (external W2)"
              }
            />
            <Field
              label={employee.payType === "FLAT_TASK" ? "Default flat rate" : "Current rate"}
              value={
                employee.hourlyRateCents !== null ? (
                  <span>
                    <MoneyDisplay cents={employee.hourlyRateCents} monospace={false} />
                    {employee.payType === "FLAT_TASK" ? " per task" : "/hr"}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label="Pay schedule"
              value={schedule ? schedule.name : "Unassigned"}
            />
            <Field label="Language" value={employee.language === "en" ? "English" : "Español"} />
            <Field
              label="NGTeco ref"
              value={employee.ngtecoEmployeeRef ?? "Not bound"}
            />
            {employee.notes && (
              <div className="sm:col-span-2 space-y-1">
                <div className="text-xs text-text-muted">Notes</div>
                <p className="whitespace-pre-wrap text-sm">{employee.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <CardTitle>Rate history</CardTitle>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/employees/${employee.id}/rate`}>
                <Receipt className="h-4 w-4" /> Add rate
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <RateHistoryList rates={rates} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
          <CardTitle>Payslips</CardTitle>
          {payslipsWithPeriods.length > 0 && (
            <RecomputePayslipsButton employeeId={employee.id} />
          )}
        </CardHeader>
        <CardContent className="space-y-1">
          {payslipsWithPeriods.length === 0 ? (
            <p className="text-sm text-text-muted">
              No payslips yet for this employee.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {payslipsWithPeriods.map(({ payslip, period }) => (
                <li
                  key={payslip.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {period
                        ? `${period.startDate} – ${period.endDate}`
                        : "Unknown period"}
                    </p>
                    <p className="text-xs text-text-muted">
                      {Number(payslip.hoursWorked).toFixed(2)} h ·{" "}
                      <MoneyDisplay
                        cents={payslip.roundedPayCents}
                        monospace={false}
                      />
                      {payslip.acknowledgedAt && " · acknowledged"}
                    </p>
                  </div>
                  {payslip.pdfPath ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        href={`/api/payslips/${payslip.id}/pdf`}
                        target="_blank"
                        rel="noopener"
                      >
                        <Download className="h-3.5 w-3.5" /> PDF
                      </Link>
                    </Button>
                  ) : (
                    <span className="text-xs text-text-subtle">No PDF</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {payrollDocs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Uploaded W2 / paystub documents</CardTitle>
            <CardDescription>
              Documents uploaded by admin for this employee (visible to them
              on /me/pay).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {payrollDocs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-2 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-text-muted shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {d.originalFilename}
                      </p>
                      <p className="text-xs text-text-muted">
                        {d.kind} · uploaded{" "}
                        {d.uploadedAt
                          .toISOString()
                          .slice(0, 10)}
                      </p>
                    </div>
                  </div>
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      href={`/api/payroll-docs/${d.id}`}
                      target="_blank"
                      rel="noopener"
                    >
                      <Download className="h-3.5 w-3.5" /> View
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent punches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {lastTen.length === 0 ? (
            <p className="text-sm text-text-muted">No punches yet.</p>
          ) : (
            lastTen.map((p) => (
              <PunchRow key={p.id} punch={p} timezone={company?.timezone ?? "America/New_York"} />
            ))
          )}
        </CardContent>
      </Card>

      <AccountSection
        employeeId={employee.id}
        employeeEmail={employee.email}
        user={account}
      />

      {employee.status !== "TERMINATED" && (
        <ArchiveEmployeeButton id={employee.id} name={employee.displayName} />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-text-muted">{label}</div>
      <div>{value}</div>
    </div>
  );
}
