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
import { getSetting } from "@/lib/settings/runtime";
import { ArchiveEmployeeButton } from "./archive-button";

export default async function EmployeeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) notFound();

  const [allShifts, rates, recentPunches, company] = await Promise.all([
    listShifts({ includeArchived: true }),
    listRates(employee.id),
    listPunches({ employeeId: employee.id, includeVoided: false }),
    getSetting("company"),
  ]);
  const shift = employee.shiftId ? allShifts.find((s) => s.id === employee.shiftId) : null;
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
            <p className="text-sm text-[--text-muted]">Legal: {employee.legalName}</p>
          )}
          <p className="text-sm text-[--text-muted]">{employee.email}</p>
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
            <Field label="Pay type" value={employee.payType === "HOURLY" ? "Hourly" : "Flat / task"} />
            <Field
              label="Current rate"
              value={
                employee.hourlyRateCents !== null ? (
                  <span><MoneyDisplay cents={employee.hourlyRateCents} monospace={false} />/hr</span>
                ) : (
                  "—"
                )
              }
            />
            <Field label="Language" value={employee.language === "en" ? "English" : "Español"} />
            <Field
              label="NGTeco ref"
              value={employee.ngtecoEmployeeRef ?? "Not bound"}
            />
            {employee.notes && (
              <div className="sm:col-span-2 space-y-1">
                <div className="text-xs text-[--text-muted]">Notes</div>
                <p className="whitespace-pre-wrap text-sm">{employee.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Rate history</CardTitle>
              <CardDescription>Most recent first</CardDescription>
            </div>
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
        <CardHeader>
          <CardTitle>Recent punches</CardTitle>
          <CardDescription>Latest 10 (current period and earlier)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {lastTen.length === 0 ? (
            <p className="text-sm text-[--text-muted]">No punches yet.</p>
          ) : (
            lastTen.map((p) => (
              <PunchRow key={p.id} punch={p} timezone={company?.timezone ?? "America/New_York"} />
            ))
          )}
        </CardContent>
      </Card>

      {employee.status !== "TERMINATED" && (
        <ArchiveEmployeeButton id={employee.id} name={employee.displayName} />
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-[--text-muted]">{label}</div>
      <div>{value}</div>
    </div>
  );
}
