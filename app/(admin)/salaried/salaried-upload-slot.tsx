"use client";

import * as React from "react";
import { PdfLink } from "@/components/domain/pdf-link";
import {
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ZohoDocStatus } from "@/components/domain/zoho-doc-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteSalariedDocAction,
  inferSalariedPeriodAction,
  setSalariedDocNetAmountAction,
  suggestNetFromPdfAction,
  uploadSalariedDocAction,
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

const KIND_LABEL: Record<DocLite["kind"], string> = {
  PAYSTUB: "Paystub",
  W2: "W2",
  OTHER: "Other",
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

/** "2143.20" from integer cents — for pre-filling the editable net input. */
function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

type ReadState =
  | { kind: "IDLE" }
  | { kind: "READING" }
  | { kind: "FILLED" }
  | { kind: "MANUAL"; reason: string };

/**
 * Per-employee paystub manager: the document list plus an ADD affordance.
 *
 * Progressive disclosure (owner: "no need for a giant upload box"): the
 * default state is a single slim "Add paystub" row. The compact form —
 * file chip, period date, kind, net — only appears once the admin starts
 * an upload (click, or drop a file straight onto the row). Period
 * inference is likewise deferred until the form is open, so a page full
 * of collapsed cards fires zero inference requests.
 */
export function SalariedUploadSlot({
  employeeId,
  docs,
}: {
  employeeId: string;
  docs: DocLite[];
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [referenceDate, setReferenceDate] = React.useState(todayStr);

  // Controlled file selection drives the drop target + auto-read.
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const [netDollars, setNetDollars] = React.useState("");
  const [readState, setReadState] = React.useState<ReadState>({ kind: "IDLE" });
  const [kind, setKind] = React.useState<DocLite["kind"]>("PAYSTUB");

  const [inferred, setInferred] = React.useState<
    | { kind: "OK"; scheduleName: string; periodKind: string; startDate: string; endDate: string }
    | { kind: "NONE" }
    | { kind: "PENDING" }
    | { kind: "ERROR"; error: string }
  >({ kind: "PENDING" });

  // Infer the pay period from the employee's schedule — but only while the
  // form is open. Admin picks any date inside the period and we resolve the
  // (start, end) bounds — shown live for verification.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInferred({ kind: "PENDING" });
    void (async () => {
      const r = await inferSalariedPeriodAction({ employeeId, referenceDate });
      if (cancelled) return;
      setInferred(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, referenceDate, open]);

  // Auto-read the net from a freshly selected PDF (best-effort). Never
  // blocks: any miss leaves the field empty for manual entry.
  const tryAutoReadNet = React.useCallback(async (picked: File) => {
    if (picked.type !== "application/pdf") {
      setReadState({ kind: "IDLE" });
      return;
    }
    setReadState({ kind: "READING" });
    const fd = new FormData();
    fd.set("file", picked);
    try {
      const r = await suggestNetFromPdfAction(fd);
      if (r.kind === "OK") {
        setNetDollars(centsToInput(r.netCents));
        setReadState({ kind: "FILLED" });
        return;
      }
      const reason =
        r.kind === "NO_TEXT"
          ? "Scanned PDF — enter net manually."
          : r.kind === "NOT_CONFIGURED"
            ? "Auto-read off — enter net manually."
            : "Couldn't read — enter net manually.";
      setReadState({ kind: "MANUAL", reason });
    } catch {
      setReadState({ kind: "MANUAL", reason: "Couldn't read — enter net manually." });
    }
  }, []);

  const onPickFile = React.useCallback(
    (picked: File | null) => {
      setError(null);
      setFile(picked);
      setNetDollars("");
      setReadState({ kind: "IDLE" });
      if (picked) {
        setOpen(true);
        void tryAutoReadNet(picked);
      }
    },
    [tryAutoReadNet],
  );

  const clearFile = React.useCallback(() => {
    setFile(null);
    setNetDollars("");
    setReadState({ kind: "IDLE" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const cancel = React.useCallback(() => {
    clearFile();
    setError(null);
    setOpen(false);
  }, [clearFile]);

  // Open the form and go straight to the file picker — one click from the
  // collapsed row to the OS dialog.
  const openAndBrowse = React.useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() => fileInputRef.current?.click());
  }, []);

  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files?.[0] ?? null;
      if (dropped) onPickFile(dropped);
    },
  };

  async function handleUpload() {
    if (!file) {
      setError("Choose a paystub file first.");
      return;
    }
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    form.set("amountDollars", netDollars);
    form.set("payPeriodStart", inferred.kind === "OK" ? inferred.startDate : "");
    form.set("payPeriodEnd", inferred.kind === "OK" ? inferred.endDate : "");
    const r = await uploadSalariedDocAction(employeeId, form);
    setPending(false);
    if (r?.error) {
      setError(r.error);
      return;
    }
    clearFile();
    setOpen(false);
  }

  return (
    <div className="space-y-3">
      {docs.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-card border border-border bg-surface overflow-hidden">
          {docs.map((d) => (
            <DocRow key={d.id} doc={d} />
          ))}
        </ul>
      )}

      {/* Always mounted so the collapsed row can open the picker directly. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.xlsx"
        className="sr-only"
        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
      />

      {!open ? (
        <button
          type="button"
          onClick={openAndBrowse}
          {...dropHandlers}
          className={[
            "flex min-h-11 w-full items-center justify-between gap-3 rounded-card border border-dashed px-3 py-2 text-sm transition-colors",
            dragOver
              ? "border-brand-700 bg-brand-50 text-brand-800"
              : "border-border text-text-muted hover:border-brand-700/60 hover:bg-surface-2/40 hover:text-text",
          ].join(" ")}
        >
          <span className="flex items-center gap-2 font-medium">
            <Plus className="h-4 w-4" aria-hidden /> Add paystub
          </span>
          <span className="hidden text-xs text-text-subtle sm:inline">
            or drop a PDF here
          </span>
        </button>
      ) : (
        <div
          {...dropHandlers}
          className={[
            "space-y-3 rounded-card border p-3 transition-colors",
            dragOver ? "border-brand-700 bg-brand-50/60" : "border-border bg-surface-2/30",
          ].join(" ")}
        >
          {/* File chip — or a compact picker when opened without a file
              (e.g. the OS dialog was dismissed). */}
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
                onClick={clearFile}
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

          {/* Fixed-width columns — a full-width date input reads as dead
              space; these three fields are all short values. */}
          <div className="grid gap-2 sm:grid-cols-[12rem_8rem_9rem]">
            <div className="space-y-1">
              <Label htmlFor={`ref-${employeeId}`} className="text-xs text-text-muted">
                Pay period covering
              </Label>
              <Input
                id={`ref-${employeeId}`}
                type="date"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value)}
              />
              {/* Resolved coverage. When a schedule is attached this resolves
                  the instant the date changes (defaulted to today), so the
                  owner can pick a PDF and hit Upload — the range shows
                  filled-in, never "blank". Back-filling an old stub is just
                  changing the date. */}
              {inferred.kind === "OK" ? (
                <div
                  className="inline-flex items-center gap-1.5 rounded-input px-2 py-1"
                  style={{
                    background: "color-mix(in srgb, var(--dash-cyan) 12%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--dash-cyan) 26%, transparent)",
                  }}
                >
                  <CalendarClock
                    className="h-3 w-3 shrink-0"
                    style={{ color: "var(--dash-cyan)" }}
                    aria-hidden="true"
                  />
                  <span
                    className="text-[11px] font-semibold tabular-nums"
                    style={{ color: "var(--dash-cyan)" }}
                  >
                    {formatRange(inferred.startDate, inferred.endDate)}
                  </span>
                </div>
              ) : (
                <p
                  className={[
                    "text-[10px] leading-tight",
                    inferred.kind === "NONE" || inferred.kind === "ERROR"
                      ? "text-warning-700"
                      : "text-text-subtle",
                  ].join(" ")}
                >
                  {inferred.kind === "NONE"
                    ? "No schedule — set one on the profile, or enter dates manually."
                    : inferred.kind === "PENDING"
                      ? "Resolving period…"
                      : "Couldn't infer; check the schedule."}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor={`kind-${employeeId}`} className="text-xs text-text-muted">
                Kind
              </Label>
              <select
                id={`kind-${employeeId}`}
                value={kind}
                onChange={(e) => setKind(e.target.value as DocLite["kind"])}
                className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
              >
                <option value="PAYSTUB">Paystub</option>
                <option value="W2">W2</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`amt-${employeeId}`} className="text-xs text-text-muted">
                Net pay $
              </Label>
              <Input
                id={`amt-${employeeId}`}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={netDollars}
                onChange={(e) => {
                  setNetDollars(e.target.value);
                  if (readState.kind === "FILLED") setReadState({ kind: "IDLE" });
                }}
                placeholder="2143.20"
                className="tabular-nums"
                title="Post-tax net the employee receives — this is what Zoho gets."
              />
            </div>
          </div>

          <ReadStatus state={readState} />

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={handleUpload} disabled={pending || !file}>
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {pending ? "Uploading…" : "Upload"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            {error && <span className="text-xs text-danger-700">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function ReadStatus({ state }: { state: ReadState }) {
  if (state.kind === "IDLE") return null;
  if (state.kind === "READING") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> Reading net from PDF…
      </p>
    );
  }
  if (state.kind === "FILLED") {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-success-700">
        <Sparkles className="h-3 w-3" /> Net read from PDF — confirm before
        upload.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-text-subtle">{state.reason}</p>
  );
}

function DocRow({ doc }: { doc: DocLite }) {
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const range = formatRange(doc.payPeriodStart, doc.payPeriodEnd);

  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 text-sm transition-colors hover:bg-surface-2/40">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileText className="h-4 w-4 shrink-0 text-text-subtle" />
          <div className="min-w-0">
            {/* The pay-period the stub COVERS is the headline — that's the
                period this paystub is for. The covered range leads in the
                accent so it reads as the row's identity; kind sits beside it,
                and the upload date is demoted to a whispered trailing detail. */}
            <p className="flex items-center gap-1.5">
              {range ? (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-chip px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{
                    background: "color-mix(in srgb, var(--dash-cyan) 15%, transparent)",
                    color: "var(--dash-cyan)",
                  }}
                >
                  <CalendarClock className="h-3 w-3" />
                  {range}
                </span>
              ) : (
                <span className="text-[11px] font-medium text-text-subtle">
                  No period set
                </span>
              )}
              <span className="text-micro uppercase text-text-subtle">
                {KIND_LABEL[doc.kind]}
              </span>
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-subtle">
              <span className="truncate text-text-muted">{doc.originalFilename}</span>
              <span aria-hidden>·</span>
              <span className="whitespace-nowrap">uploaded {doc.uploadedAt.slice(0, 10)}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <InlineNet doc={doc} />
          <ZohoDocStatus doc={doc} />
          <Button asChild size="sm" variant="ghost">
            <PdfLink
              href={`/api/payroll-docs/${doc.id}`}
              filename="paystub.pdf"
              title="View document"
            >
              <Download className="h-3.5 w-3.5" /> View
            </PdfLink>
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
              title="Remove document"
            >
              <Trash2 className="h-3.5 w-3.5 text-danger-700" />
            </Button>
          </form>
        </div>
      </div>
      {error && <span className="text-xs text-danger-700">{error}</span>}
    </li>
  );
}

/**
 * Inline-editable net amount. Click the amount → it becomes an input →
 * save persists via the existing audited action. Replaces the old
 * separate "Save net" yellow box. W2/Other rows just show their amount
 * (or nothing) and aren't editable here.
 */
function InlineNet({ doc }: { doc: DocLite }) {
  // Paystub nets stay editable even after a Zoho push — correcting a mistake
  // is exactly when you need it. Re-push (in ZohoDocStatus) resyncs Zoho.
  const editable = doc.kind === "PAYSTUB";
  const hasAmount = doc.amountCents !== null && doc.amountCents > 0;

  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(
    hasAmount ? centsToInput(doc.amountCents as number) : "",
  );
  const [amountCents, setAmountCents] = React.useState<number | null>(doc.amountCents);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const liveHasAmount = amountCents !== null && amountCents > 0;

  // Non-paystub or already-in-Zoho: read-only display.
  if (!editable) {
    if (!liveHasAmount) return null;
    return (
      <span className="tabular-nums text-xs text-text-muted">
        {formatMoney(amountCents as number)}
      </span>
    );
  }

  async function save() {
    setPending(true);
    setError(null);
    const r = await setSalariedDocNetAmountAction(doc.id, value.trim());
    setPending(false);
    if (r?.error) {
      setError(r.error);
      return;
    }
    const cents = Math.round(Number(value.trim()) * 100);
    setAmountCents(cents);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <Input
          ref={inputRef}
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="1702.42"
          className="h-7 w-24 tabular-nums text-xs"
          disabled={pending}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void save()}
          disabled={pending}
          title="Save net"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success-700" />
          )}
        </Button>
        {error && (
          <span className="max-w-[10rem] text-[10px] text-danger-700">{error}</span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit net pay"
      className={[
        "rounded-chip px-2 py-0.5 tabular-nums text-xs transition-colors",
        liveHasAmount
          ? "text-text hover:bg-surface-2/40"
          : "bg-warning-50 text-warning-700 hover:bg-warning-50/80",
      ].join(" ")}
    >
      {liveHasAmount ? formatMoney(amountCents as number) : "Add net $"}
    </button>
  );
}
