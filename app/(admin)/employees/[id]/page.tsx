import { notFound } from "next/navigation";
import Link from "next/link";
import { PdfLink } from "@/components/domain/pdf-link";
import { ArrowLeft, Pencil, Receipt, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/domain/status-pill";
import { ShiftChip } from "@/components/domain/shift-chip";
import { Avatar } from "@/components/domain/avatar";
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
import { ReinstateEmployeeButton } from "./reinstate-button";
import { AccountSection } from "./account-section";
import { RecomputePayslipsButton } from "./recompute-button";
import { PayslipBatchPrintList } from "@/components/domain/payslip-batch-print-list";
import { formatHours, formatMoney } from "@/lib/utils";
import { formatPeriodRange, shortRange } from "@/lib/payroll/format-period";
import { todayInCompanyTz } from "@/lib/time/format";
import {
  formatIsoDate,
  formatTenure,
  parseEmployeeNotes,
  summarizePay,
} from "@/lib/employees/profile-summary";
import { DetailsCard, EmployeeSummary, NotesCard } from "./profile-panels";

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
  const timezone = company?.timezone ?? "America/New_York";
  const today = todayInCompanyTz(timezone);

  const payslipRows = payslipsWithPeriods.map(({ payslip, period }) => ({
    payslip,
    periodStart: period?.startDate ?? "",
    periodEnd: period?.endDate ?? "",
    periodLabel: period
      ? formatPeriodRange(period.startDate, period.endDate)
      : "Unknown period",
    shortLabel: period ? shortRange(period.startDate, period.endDate) : "",
    hours: Number(payslip.hoursWorked),
    payCents: payslip.roundedPayCents,
  }));
  const paySummary = summarizePay(payslipRows, today);
  // Rates come newest first; the current one is the latest already in effect
  // (a raise entered ahead of time must not show as today's rate).
  const currentRate = rates.find((r) => r.effectiveFrom <= today) ?? null;

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
              <h1 className="text-title tracking-tight antialiased text-text truncate">
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

      {employee.status === "TERMINATED" && (
        <ReinstateEmployeeButton id={employee.id} name={employee.displayName} />
      )}

      <EmployeeSummary
        rateLabel={isFlatTask ? "Default flat rate" : "Current rate"}
        rateCents={
          isFlatTask
            ? employee.hourlyRateCents
            : (currentRate?.hourlyRateCents ?? employee.hourlyRateCents)
        }
        rateUnit={isFlatTask ? " /task" : "/hr"}
        rateSince={currentRate?.effectiveFrom ?? null}
        lastPaid={
          paySummary.lastPaid
            ? {
                payCents: paySummary.lastPaid.payCents,
                periodLabel: paySummary.lastPaid.shortLabel,
                hoursLabel: `${formatHours(paySummary.lastPaid.hours)} h`,
              }
            : null
        }
        year={paySummary.year}
        ytdPayCents={paySummary.ytdPayCents}
        ytdHoursLabel={`${formatHours(paySummary.ytdHours)} h`}
        ytdPaidCount={paySummary.ytdPaidCount}
        tenure={formatTenure(employee.hiredOn, today)}
        hiredOn={employee.hiredOn}
      />

      {/* Two columns from xl up (lg leaves the right column ~360px once the
          sidebar is counted, which wraps the punch times):
          Left rail — who they are and how they are paid (details, rates, notes)
          Right     — what happened (payslips, documents, punches)
          Between md and xl the rail lays its cards side by side instead of
          stretching one label/value list across the full page width.        */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <DetailsCard
            rows={[
              { label: "Pay type", value: payTypeLabel },
              {
                label: "Pay schedule",
                value: schedule ? (
                  schedule.name
                ) : (
                  <span className="text-text-subtle">Unassigned</span>
                ),
              },
              { label: "Hired", value: formatIsoDate(employee.hiredOn) },
              {
                label: "Paid by",
                value:
                  employee.payoutPreference === "ZELLE" ? (
                    `Zelle · ${employee.zelleContact}`
                  ) : employee.payoutPreference === "CASH" ? (
                    "Cash"
                  ) : (
                    <span className="text-text-subtle">Not set</span>
                  ),
              },
              { label: "Phone", value: employee.phone },
              { label: "Email", value: employee.email },
              {
                label: "Language",
                value: employee.language === "en" ? "English" : "Español",
              },
              {
                label: "NGTeco ref",
                value: employee.ngtecoEmployeeRef ?? (
                  <span className="text-text-subtle">Not bound</span>
                ),
              },
            ]}
          />

          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
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

            <NotesCard
              entries={parseEmployeeNotes(employee.notes)}
              timezone={timezone}
            />
          </div>
        </div>

        {/* Right: work history + payslips + punches */}
        <div className="space-y-4 min-w-0">
          <Card>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>Payslips</CardTitle>
              {payslipsWithPeriods.length > 0 && (
                <RecomputePayslipsButton employeeId={employee.id} />
              )}
            </CardHeader>
            {payslipRows.length === 0 ? (
              <CardContent>
                <p className="text-sm text-text-muted">
                  No payslips yet for this employee.
                </p>
              </CardContent>
            ) : (
              <PayslipBatchPrintList
                employeeId={employee.id}
                items={payslipRows.map((row) => ({
                  id: row.payslip.id,
                  periodLabel: row.periodLabel,
                  hoursLabel: `${formatHours(row.hours)} h`,
                  payLabel: formatMoney(row.payCents),
                  isEmpty: row.hours === 0 && row.payCents === 0,
                  acknowledged: Boolean(row.payslip.acknowledgedAt),
                  disputed: Boolean(
                    row.payslip.disputedAt && !row.payslip.disputeResolvedAt,
                  ),
                  pdfPath: row.payslip.pdfPath,
                }))}
              />
            )}
          </Card>

          {payrollDocs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Uploaded W2 / paystub documents</CardTitle>
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
                            {d.kind} · uploaded {formatIsoDate(d.uploadedAt.toISOString().slice(0, 10))}
                          </p>
                        </div>
                      </div>
                      <Button asChild size="sm" variant="ghost">
                        <PdfLink href={`/api/payroll-docs/${d.id}`} filename="paystub.pdf">
                          <Download className="h-3.5 w-3.5" /> View
                        </PdfLink>
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
            <CardContent className="space-y-2 py-3">
              {lastTen.length === 0 ? (
                <p className="text-sm text-text-muted">No punches yet.</p>
              ) : (
                lastTen.map((p) => (
                  <PunchRow
                    key={p.id}
                    punch={p}
                    timezone={timezone}
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
