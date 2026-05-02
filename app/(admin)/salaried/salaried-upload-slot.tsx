"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileText, PlugZap, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteSalariedDocAction,
  listZohoOrgsAction,
  pushDocToZohoAction,
  uploadSalariedDocAction,
  type ZohoOrgChoice,
} from "./actions";

type DocLite = {
  id: string;
  originalFilename: string;
  kind: "W2" | "PAYSTUB" | "OTHER";
  uploadedAt: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  amountCents: number | null;
  zohoExpenseId: string | null;
};

function formatRange(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${m[a.getUTCMonth()]} ${a.getUTCDate()}${sameYear ? "" : `, ${a.getUTCFullYear()}`}`;
  const right = `${m[b.getUTCMonth()]} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;
  return `${left} – ${right}`;
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function SalariedUploadSlot({
  employeeId,
  docs,
}: {
  employeeId: string;
  docs: DocLite[];
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="space-y-3">
      {docs.length > 0 && (
        <ul className="divide-y divide-border rounded-card border border-border">
          {docs.map((d) => (
            <DocRow key={d.id} doc={d} />
          ))}
        </ul>
      )}

      <form
        action={async (form) => {
          setPending(true);
          setError(null);
          const r = await uploadSalariedDocAction(employeeId, form);
          setPending(false);
          if (r?.error) setError(r.error);
        }}
        className="space-y-2"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`file-${employeeId}`} className="text-xs">
              Upload PDF / PNG / JPG / XLSX (max 10 MB)
            </Label>
            <Input
              id={`file-${employeeId}`}
              name="file"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.xlsx"
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`kind-${employeeId}`} className="text-xs">
              Kind
            </Label>
            <select
              id={`kind-${employeeId}`}
              name="kind"
              defaultValue="PAYSTUB"
              className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
            >
              <option value="PAYSTUB">Paystub</option>
              <option value="W2">W2</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label
              htmlFor={`pps-${employeeId}`}
              className="text-xs text-text-muted"
            >
              Pay period start (optional)
            </Label>
            <Input
              id={`pps-${employeeId}`}
              name="payPeriodStart"
              type="date"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={`ppe-${employeeId}`}
              className="text-xs text-text-muted"
            >
              Pay period end (optional)
            </Label>
            <Input
              id={`ppe-${employeeId}`}
              name="payPeriodEnd"
              type="date"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor={`amt-${employeeId}`}
              className="text-xs text-text-muted"
            >
              Net amount $ (optional)
            </Label>
            <Input
              id={`amt-${employeeId}`}
              name="amountDollars"
              type="number"
              step="0.01"
              min="0"
              placeholder="2143.20"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            <Upload className="h-3.5 w-3.5" />
            {pending ? "Uploading…" : "Upload"}
          </Button>
          {error && <span className="text-xs text-red-700">{error}</span>}
        </div>
      </form>
    </div>
  );
}

function DocRow({ doc }: { doc: DocLite }) {
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-4 w-4 text-text-muted shrink-0" />
        <div className="min-w-0">
          <p className="font-medium truncate">{doc.originalFilename}</p>
          <p className="text-xs text-text-muted">
            {doc.kind}
            {(() => {
              const range = formatRange(doc.payPeriodStart, doc.payPeriodEnd);
              return range ? ` · ${range}` : "";
            })()}
            {doc.amountCents !== null && doc.amountCents > 0
              ? ` · ${formatMoney(doc.amountCents)}`
              : ""}
            {" · uploaded "}
            {doc.uploadedAt.slice(0, 10)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button asChild size="sm" variant="ghost">
          <Link
            href={`/api/payroll-docs/${doc.id}`}
            target="_blank"
            rel="noopener"
          >
            <Download className="h-3.5 w-3.5" /> View
          </Link>
        </Button>
        <ZohoPushButton doc={doc} />
        <form
          action={async () => {
            if (removing) return;
            setRemoving(true);
            setError(null);
            const r = await deleteSalariedDocAction(doc.id);
            setRemoving(false);
            if (r?.error) setError(r.error);
          }}
        >
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            disabled={removing}
            title="Remove"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-600" />
          </Button>
        </form>
      </div>
      {error && (
        <span className="text-xs text-red-700 ml-auto">{error}</span>
      )}
    </li>
  );
}

function ZohoPushButton({ doc }: { doc: DocLite }) {
  const [orgs, setOrgs] = React.useState<ZohoOrgChoice[] | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pushedExpenseId, setPushedExpenseId] = React.useState<string | null>(
    doc.zohoExpenseId,
  );

  // Don't show the push button for W2 docs (legal record, not an expense).
  if (doc.kind === "W2") return null;

  if (pushedExpenseId) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-input bg-emerald-50 text-emerald-700 px-1.5 py-0.5 text-[10px]"
        title={`Pushed to Zoho: expense ${pushedExpenseId}`}
      >
        <CheckCircle2 className="h-3 w-3" /> Zoho
      </span>
    );
  }

  return (
    <span className="relative">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        title="Push to Zoho Books as an expense"
        onClick={async () => {
          setError(null);
          if (!orgs) {
            const list = await listZohoOrgsAction();
            setOrgs(list);
            if (list.length === 0) {
              setError(
                "No active Zoho orgs. Connect one in /settings/zoho first.",
              );
              return;
            }
            if (list.length === 1) {
              // One org → push directly without picker UI.
              setPending(true);
              const r = await pushDocToZohoAction(doc.id, list[0]!.id);
              setPending(false);
              if ("error" in r) setError(r.error);
              else setPushedExpenseId(r.expenseId);
              return;
            }
            setPicking(true);
            return;
          }
          if (orgs.length === 1) {
            setPending(true);
            const r = await pushDocToZohoAction(doc.id, orgs[0]!.id);
            setPending(false);
            if ("error" in r) setError(r.error);
            else setPushedExpenseId(r.expenseId);
            return;
          }
          setPicking((p) => !p);
        }}
      >
        <PlugZap className="h-3.5 w-3.5" /> Zoho
      </Button>
      {picking && orgs && orgs.length > 1 && (
        <div className="absolute right-0 top-full z-10 mt-1 rounded-card border border-border bg-surface shadow-card text-xs min-w-40">
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              className="block w-full text-left px-3 py-2 hover:bg-surface-2"
              onClick={async () => {
                setPicking(false);
                setPending(true);
                setError(null);
                const r = await pushDocToZohoAction(doc.id, o.id);
                setPending(false);
                if ("error" in r) setError(r.error);
                else setPushedExpenseId(r.expenseId);
              }}
            >
              Push to {o.name}
            </button>
          ))}
        </div>
      )}
      {error && (
        <span className="absolute right-0 top-full mt-1 text-[10px] text-red-700 whitespace-nowrap">
          {error}
        </span>
      )}
    </span>
  );
}
