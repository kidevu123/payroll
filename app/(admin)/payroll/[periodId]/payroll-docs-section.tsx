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
  "id" | "displayName" | "requiresW2Upload" | "payType"
>;

export function PayrollDocsSection({
  periodId,
  employees,
  initialDocs,
  locked,
}: {
  periodId: string;
  employees: EmployeeLite[];
  initialDocs: PayrollPeriodDocument[];
  locked: boolean;
}) {
  // Anyone flagged as W2 upload required, plus anyone on SALARIED pay
  // type (they're externally paid by definition).
  const w2Employees = employees.filter(
    (e) => e.requiresW2Upload || e.payType === "SALARIED",
  );

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
          className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end"
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
          <div className="sm:col-span-3 flex items-center gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              <Upload className="h-3.5 w-3.5" />
              {pending ? "Uploading…" : "Upload"}
            </Button>
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
