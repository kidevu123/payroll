"use client";

import * as React from "react";
import Link from "next/link";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import type { Employee, PayrollPeriodDocument } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deletePayrollDocAction,
  uploadPayrollDocAction,
} from "./payroll-docs-actions";

type EmployeeLite = Pick<
  Employee,
  "id" | "displayName" | "requiresW2Upload" | "payType" | "payScheduleId"
>;

export function PayrollDocsSection({
  periodId,
  periodPayScheduleId,
  /** The period's pay_schedule.period_kind. Used to keep SALARIED
   *  employees off WEEKLY periods regardless of what their stored
   *  schedule says — weekly is punch-driven; a salaried W2 slot
   *  there is always a data error. */
  periodKind,
  employees,
  initialDocs,
  locked,
}: {
  periodId: string;
  periodPayScheduleId: string | null;
  periodKind: "WEEKLY" | "BIWEEKLY" | "SEMI_MONTHLY" | "MONTHLY" | null;
  employees: EmployeeLite[];
  initialDocs: PayrollPeriodDocument[];
  locked: boolean;
}) {
  // STRICT schedule isolation. An employee's paystub upload belongs on
  // the period that matches their pay schedule and nowhere else.
  //
  //   period.payScheduleId === employee.payScheduleId  → show
  //   anything else                                     → hide
  //
  // Plus a SALARIED-not-on-WEEKLY guard: weekly is a punch-driven
  // cadence; if the data ever has a salaried employee on a weekly
  // schedule (Seri's profile in production had this), we exclude them
  // here so they never bleed onto the weekly period's W2 slot.
  // Owner directive: "SERI STILL SHOWS ON THE WEEKLY!" — even with a
  // matching schedule_id, we refuse the combination at the filter.
  const w2Employees = employees.filter((e) => {
    if (!e.requiresW2Upload) return false;
    if (e.payScheduleId !== periodPayScheduleId) return false;
    if (e.payType === "SALARIED" && periodKind === "WEEKLY") return false;
    return true;
  });

  if (w2Employees.length === 0) {
    return null;
  }

  // Group docs by employeeId for fast lookup.
  const docsByEmployee = new Map<string, PayrollPeriodDocument[]>();
  for (const d of initialDocs) {
    if (d.deletedAt) continue;
    const list = docsByEmployee.get(d.employeeId) ?? [];
    list.push(d);
    docsByEmployee.set(d.employeeId, list);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">W2 / paystub documents</CardTitle>
        <CardDescription>
          For employees whose pay is prepared externally (e.g. accountant).
          Upload the document here and the employee will see it under their
          Pay tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {w2Employees.map((e) => (
          <EmployeeDocSlot
            key={e.id}
            periodId={periodId}
            employee={e}
            docs={docsByEmployee.get(e.id) ?? []}
            locked={locked}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function EmployeeDocSlot({
  periodId,
  employee,
  docs,
  locked,
}: {
  periodId: string;
  employee: EmployeeLite;
  docs: PayrollPeriodDocument[];
  locked: boolean;
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="rounded-card border border-border bg-surface-2/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{employee.displayName}</p>
          <p className="text-xs text-text-muted">
            {docs.length === 0
              ? "No document uploaded yet."
              : `${docs.length} document${docs.length === 1 ? "" : "s"} on file.`}
          </p>
        </div>
      </div>

      {docs.length > 0 && (
        <ul className="space-y-1 text-sm">
          {docs.map((d) => (
            <DocRow key={d.id} doc={d} locked={locked} />
          ))}
        </ul>
      )}

      {!locked && (
        <form
          action={async (form) => {
            form.set("employeeId", employee.id);
            setPending(true);
            setError(null);
            const result = await uploadPayrollDocAction(periodId, form);
            setPending(false);
            if (result?.error) setError(result.error);
          }}
          className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end"
        >
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`file-${employee.id}`} className="text-xs">
              Upload PDF / PNG / JPG / XLSX (max 10 MB)
            </Label>
            <Input
              id={`file-${employee.id}`}
              name="file"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.xlsx"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`kind-${employee.id}`} className="text-xs">
              Kind
            </Label>
            <select
              id={`kind-${employee.id}`}
              name="kind"
              defaultValue="PAYSTUB"
              className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
            >
              <option value="PAYSTUB">Paystub</option>
              <option value="W2">W2</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`amt-${employee.id}`} className="text-xs">
              Net pay $ (post-tax)
            </Label>
            <Input
              id={`amt-${employee.id}`}
              name="netAmountDollars"
              type="number"
              step="0.01"
              min="0"
              placeholder="1685.00"
              title="The net amount you actually wire to the employee — what gets pushed to Zoho. The gross is on the PDF; this is gross minus all taxes/withholdings. Required for paystubs."
            />
          </div>
          <div className="sm:col-span-4 flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              <Upload className="h-3.5 w-3.5" />
              {pending ? "Uploading…" : "Upload"}
            </Button>
            <span className="text-[11px] text-text-muted">
              Net pay drives the Zoho expense amount; the gross on the PDF is for
              record-keeping only.
            </span>
            {error && (
              <span className="text-xs text-red-700">{error}</span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function DocRow({
  doc,
  locked,
}: {
  doc: PayrollPeriodDocument;
  locked: boolean;
}) {
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <li className="flex items-center justify-between gap-2 rounded-input border border-border bg-surface px-2 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-4 w-4 text-text-muted shrink-0" />
        <span className="truncate font-medium">{doc.originalFilename}</span>
        <span className="text-xs text-text-muted shrink-0">
          · {doc.kind}
        </span>
        {doc.amountCents !== null && (
          <span
            className="text-xs font-medium text-emerald-700 shrink-0"
            title="Net pay (post-tax) — pushed to Zoho when this is the latest paystub for the period."
          >
            · ${(doc.amountCents / 100).toFixed(2)} net
          </span>
        )}
        {doc.kind === "PAYSTUB" && doc.amountCents === null && (
          <span
            className="text-xs font-medium text-amber-700 shrink-0"
            title="Net amount missing — re-upload with net amount filled in, or this paystub will push $0 to Zoho."
          >
            · net amount missing
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button asChild size="sm" variant="ghost">
          <Link
            href={`/api/payroll-docs/${doc.id}`}
            target="_blank"
            rel="noopener"
          >
            <Download className="h-3.5 w-3.5" />
          </Link>
        </Button>
        {!locked && (
          <form
            action={async () => {
              if (removing) return;
              setRemoving(true);
              setError(null);
              const result = await deletePayrollDocAction(doc.id);
              setRemoving(false);
              if (result?.error) setError(result.error);
            }}
          >
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              disabled={removing}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </form>
        )}
      </div>
      {error && (
        <span className="text-xs text-red-700 sm:ml-auto">{error}</span>
      )}
    </li>
  );
}
