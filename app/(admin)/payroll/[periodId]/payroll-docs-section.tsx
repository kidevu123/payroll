"use client";

import * as React from "react";
import Link from "next/link";
import { PdfLink } from "@/components/domain/pdf-link";
import { Download, FileText, Plus, Trash2, Upload, X } from "lucide-react";
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
import { ZohoDocStatus } from "@/components/domain/zoho-doc-status";

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
        <CardTitle>W2 / paystub documents</CardTitle>
        <CardDescription>
          For employees whose pay is prepared externally. Upload the document
          and the employee sees it under their Pay tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border/60 p-0">
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

const KIND_LABEL: Record<"PAYSTUB" | "W2" | "OTHER", string> = {
  PAYSTUB: "Paystub",
  W2: "W2",
  OTHER: "Other",
};

/**
 * One employee's row. Progressive disclosure (owner: "no need for a giant
 * upload box"): the resting state is the name, the on-file documents and a
 * single slim "Add paystub" affordance. Clicking it opens the OS picker
 * straight away; the compact form (file chip, kind, net, Upload) appears
 * only once a file is chosen or dropped onto the row.
 */
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
  const [file, setFile] = React.useState<File | null>(null);
  const [open, setOpen] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const pickFile = (f: File | null) => {
    if (!f) return;
    setFile(f);
    setOpen(true);
    setError(null);
  };
  const reset = () => {
    setFile(null);
    setOpen(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const dropHandlers = locked
    ? {}
    : {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(true);
        },
        onDragLeave: () => setDragOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          pickFile(e.dataTransfer.files?.[0] ?? null);
        },
      };

  return (
    <div
      {...dropHandlers}
      className={[
        "space-y-3 px-6 py-4 transition-colors",
        dragOver ? "bg-brand-50/60" : "",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{employee.displayName}</p>
          <p className="text-xs text-text-muted">
            {docs.length === 0
              ? "No document yet"
              : `${docs.length} document${docs.length === 1 ? "" : "s"} on file`}
          </p>
        </div>
        {!locked && !open && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="border-dashed"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add paystub
          </Button>
        )}
      </div>

      {docs.length > 0 && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-card border border-border bg-surface text-sm">
          {docs.map((d) => (
            <DocRow key={d.id} doc={d} locked={locked} />
          ))}
        </ul>
      )}

      {!locked && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.xlsx"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      )}

      {!locked && open && (
        <form
          action={async (form) => {
            if (!file) {
              setError("Choose a file first.");
              return;
            }
            form.set("employeeId", employee.id);
            form.set("file", file);
            setPending(true);
            setError(null);
            const result = await uploadPayrollDocAction(periodId, form);
            setPending(false);
            if (result?.error) setError(result.error);
            else reset();
          }}
          className="space-y-3 rounded-card border border-border bg-surface-2/30 p-3"
        >
          {file ? (
            <div className="flex items-center justify-between gap-3 rounded-input border border-border bg-surface px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{file.name}</p>
                  <p className="text-[11px] text-text-subtle">
                    {(file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={reset}
                title="Remove file"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-input border border-dashed border-border bg-surface px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:border-brand-700/60 hover:text-text"
            >
              <FileText className="h-4 w-4" aria-hidden /> Choose file
              <span className="text-xs font-normal text-text-subtle">
                PDF, PNG, JPG, or XLSX · max 10 MB
              </span>
            </button>
          )}

          <div className="grid gap-2 sm:grid-cols-[8rem_10rem]">
            <div className="space-y-1">
              <Label htmlFor={`kind-${employee.id}`} className="text-xs text-text-muted">
                Kind
              </Label>
              <select
                id={`kind-${employee.id}`}
                name="kind"
                defaultValue="PAYSTUB"
                className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
              >
                {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`amt-${employee.id}`} className="text-xs text-text-muted">
                Net pay (post-tax)
              </Label>
              <Input
                id={`amt-${employee.id}`}
                name="netAmountDollars"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="1685.00"
                className="tabular-nums"
                title="The net amount actually paid to the employee. This is what gets pushed to Zoho; the gross on the PDF is for record-keeping only."
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={pending || !file}>
              <Upload className="h-3.5 w-3.5" />
              {pending ? "Uploading…" : "Upload"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
            <span className="text-[11px] text-text-subtle">
              Net pay drives the Zoho expense amount.
            </span>
            {error && <span className="text-xs text-danger-700">{error}</span>}
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
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-4 w-4 text-text-muted shrink-0" />
        <span className="truncate font-medium">{doc.originalFilename}</span>
        <span className="text-xs text-text-muted shrink-0">
          · {KIND_LABEL[doc.kind]}
        </span>
        {doc.amountCents !== null && (
          <span
            className="text-xs font-medium text-success-700 shrink-0"
            title="Net pay (post-tax) — pushed to Zoho when this is the latest paystub for the period."
          >
            · ${(doc.amountCents / 100).toFixed(2)} net
          </span>
        )}
        {doc.kind === "PAYSTUB" && doc.amountCents === null && (
          <span
            className="text-xs font-medium text-warning-700 shrink-0"
            title="Net amount missing — re-upload with net amount filled in, or this paystub will push $0 to Zoho."
          >
            · net amount missing
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {/* Zoho stays available on locked/PAID periods — pushing the expense
            is exactly what happens after paying. Hourly requiresW2Upload
            employees never appear on the Salaried page, so this is the only
            place their paystub can be pushed. */}
        <ZohoDocStatus doc={doc} />
        <Button asChild size="sm" variant="ghost">
          <PdfLink href={`/api/payroll-docs/${doc.id}`} filename="paystub.pdf">
            <Download className="h-3.5 w-3.5" />
          </PdfLink>
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
              aria-label={`Delete document ${doc.originalFilename}`}
              title="Delete document"
              onClick={(e) => {
                if (
                  !window.confirm(
                    `Delete "${doc.originalFilename}"? This can't be undone.`,
                  )
                )
                  e.preventDefault();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </form>
        )}
      </div>
      {error && (
        <span className="text-xs text-danger-700 sm:ml-auto">{error}</span>
      )}
    </li>
  );
}
