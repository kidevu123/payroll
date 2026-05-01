"use client";

import * as React from "react";
import Link from "next/link";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteSalariedDocAction,
  uploadSalariedDocAction,
} from "./actions";

type DocLite = {
  id: string;
  originalFilename: string;
  kind: "W2" | "PAYSTUB" | "OTHER";
  uploadedAt: string;
};

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
        className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end"
      >
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
        <div className="sm:col-span-3 flex items-center gap-2">
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
            {doc.kind} · uploaded {doc.uploadedAt.slice(0, 10)}
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
