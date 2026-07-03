import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Receipt,
  Download,
  FileText,
  Briefcase,
  Calendar,
  CircleDollarSign,
  Mail,
  Phone,
  Languages,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/domain/status-pill";
import { ShiftChip } from "@/components/domain/shift-chip";
import { Avatar } from "@/components/domain/avatar";
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
import { ArchiveEmployeeButton } from "./archive-button";
import { AccountSection } from "./account-section";
import { RecomputePayslipsButton } from "./recompute-button";
import { PayslipBatchPrintList } from "@/components/domain/payslip-batch-print-list";

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
  const isFlatTask = employee.payType === "FLAT_TASK";
  const payTypeLabel =
    employee.payType === "HOURLY"
      ? "Hourly"
      : employee.payType === "FLAT_TASK"
        ? "Flat / task"
        : "Salaried (W2)";

  return (
    <div className="space-y-5">
      {/* Back link */}
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/employees">
          <ArrowLeft className="h-4 w-4" /> All employees
        </Link>
      </Button>

      {/* Header: avatar + name + status, with edit/shift on the right. Tighter
          than the previous "form dump" header — one row, no wasted vertical. */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={employee.displayName} size="lg" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-title font-semibold tracking-tight truncate">
                {employee.displayName}
              </h1>
              <StatusPill status={employee.status} />
              {shift ? (
                <ShiftChip name={shift.name} colorHex={shift.colorHex} archived={!!shift.archivedAt} />
              ) : null}
            </div>
            <div className="text-xs text-text-muted">
              {employee.legalName !== employee.displayName ? (
                <span>Legal: {employee.legalName} · </span>
              ) : null}
              <span>{employee.email}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/employees/${employee.id}/edit`}>
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </Button>
        </div>
      </div>

      {/* Two-column split:
          Left  — stats card (status, rate, hire date, shift, etc.)
          Right — work history (rate history + payslips + punches)        */}
      <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4">
        {/* Left: stats */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Stat
                Icon={CircleDollarSign}
                label={isFlatTask ? "Default flat rate" : "Current rate"}
                value={
                  employee.hourlyRateCents !== null ? (
                    <span>
                      <MoneyDisplay cents={employee.hourlyRateCents} monospace={false} />
                      <span className="text-text-muted">{isFlatTask ? " /task" : "/hr"}</span>
                    </span>
                  ) : (
                    <span className="text-text-subtle">—</span>
                  )
                }
              />
              <Stat
                Icon={Briefcase}
                label="Pay type"
                value={payTypeLabel}
              />
              <Stat
                Icon={Calendar}
                label="Hired on"
                value={employee.hiredOn}
              />
              <Stat
                Icon={Calendar}
                label="Pay schedule"
                value={schedule ? schedule.name : <span className="text-text-subtle">Unassigned</span>}
              />
              <Stat
                Icon={Phone}
                label="Phone"
                value={employee.phone ?? <span className="text-text-subtle">—</span>}
              />
              <Stat
                Icon={Mail}
                label="Email"
                value={<span className="truncate block">{employee.email}</span>}
              />
              <Stat
                Icon={Languages}
                label="Language"
                value={employee.language === "en" ? "English" : "Español"}
              />
              <Stat
                Icon={LinkIcon}
                label="NGTeco ref"
                value={
                  employee.ngtecoEmployeeRef ?? (
                    <span className="text-text-subtle">Not bound</span>
                  )
                }
              />
              {employee.notes ? (
                <div className="pt-2 border-t border-border/60 space-y-1">
                  <div className="text-xs text-text-muted">Notes</div>
                  <p className="whitespace-pre-wrap text-sm">{employee.notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Right: work history + payslips + punches */}
        <div className="space-y-4 min-w-0">
          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm">Rate history</CardTitle>
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

          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm">Payslips</CardTitle>
              {payslipsWithPeriods.length > 0 && (
                <RecomputePayslipsButton employeeId={employee.id} />
              )}
            </CardHeader>
            <CardContent className="py-2">
              {payslipsWithPeriods.length === 0 ? (
                <p className="text-sm text-text-muted py-2">
                  No payslips yet for this employee.
                </p>
              ) : (
                <PayslipBatchPrintList
                  employeeId={employee.id}
                  items={payslipsWithPeriods.map(({ payslip, period }) => ({
                    id: payslip.id,
                    periodLabel: period
                      ? `${period.startDate} – ${period.endDate}`
                      : "Unknown period",
                    hoursLabel: `${Number(payslip.hoursWorked).toFixed(2)} h`,
                    payLabel: `$${(payslip.roundedPayCents / 100).toFixed(2)}`,
                    acknowledged: Boolean(payslip.acknowledgedAt),
                    pdfPath: payslip.pdfPath,
                  }))}
                />
              )}
            </CardContent>
          </Card>

          {payrollDocs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Uploaded W2 / paystub documents</CardTitle>
                <CardDescription>
                  Visible to the employee on their /me/pay tab.
                </CardDescription>
              </CardHeader>
              <CardContent className="py-2">
                <ul className="divide-y divide-border/60">
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
                            {d.kind} · uploaded {d.uploadedAt.toISOString().slice(0, 10)}
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
              <CardTitle className="text-sm">Recent punches</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 py-3">
              {lastTen.length === 0 ? (
                <p className="text-sm text-text-muted">No punches yet.</p>
              ) : (
                lastTen.map((p) => (
                  <PunchRow
                    key={p.id}
                    punch={p}
                    timezone={company?.timezone ?? "America/New_York"}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Account moved out of the narrow left column so the password /
          role / deactivate panels render at full page width — the
          previous layout squeezed them into a 320px slot, clipping
          buttons and stacking labels onto multiple lines. */}
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

function Stat({
  Icon,
  label,
  value,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <Icon className="h-4 w-4 text-text-subtle shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-text-subtle">
          {label}
        </div>
        <div className="text-sm text-text">{value}</div>
      </div>
    </div>
  );
}
