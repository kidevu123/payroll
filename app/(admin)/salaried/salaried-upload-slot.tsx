"use client";

import * as React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  PlugZap,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  deleteSalariedDocAction,
  inferSalariedPeriodAction,
  listZohoOrgsAction,
  pushDocToZohoAction,
  setSalariedDocNetAmountAction,
  suggestNetFromPdfAction,
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

export function SalariedUploadSlot({
  employeeId,
  docs,
}: {
  employeeId: string;
  docs: DocLite[];
}) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [referenceDate, setReferenceDate] = React.useState(todayStr);

  // Controlled file selection drives the drag-and-drop zone + auto-read.
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

  // Infer the pay period from the employee's schedule whenever the
  // reference date changes. Admin picks any date inside the period and we
  // resolve the (start, end) bounds — shown live for verification.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await inferSalariedPeriodAction({ employeeId, referenceDate });
      if (cancelled) return;
      setInferred(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [employeeId, referenceDate]);

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
      if (picked) void tryAutoReadNet(picked);
    },
    [tryAutoReadNet],
  );

  const clearFile = React.useCallback(() => {
    setFile(null);
    setNetDollars("");
    setReadState({ kind: "IDLE" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const scheduleBadge =
    inferred.kind === "OK" ? prettyPeriodKind(inferred.periodKind) : null;

  async function handleUpload() {
    if (!file) {
      setError("Drop a paystub or browse to choose a file.");
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
  }

  return (
    <div className="space-y-4">
      {docs.length > 0 && (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface overflow-hidden">
          {docs.map((d) => (
            <DocRow key={d.id} doc={d} />
          ))}
        </ul>
      )}

      {scheduleBadge && (
        <div className="flex items-center gap-2 text-xs text-text-subtle">
          <span className="inline-flex items-center rounded-chip bg-surface-2 px-2 py-0.5 font-medium text-text-muted">
            {scheduleBadge}
          </span>
          <span className="truncate">
            {inferred.kind === "OK"
              ? `${inferred.scheduleName} · ${formatRange(inferred.startDate, inferred.endDate)}`
              : null}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Drag-and-drop upload zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a paystub PDF, or browse"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = e.dataTransfer.files?.[0] ?? null;
            if (dropped) onPickFile(dropped);
          }}
          className={[
            "group flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-card border border-dashed px-4 py-7 text-center transition-colors",
            dragOver
              ? "border-brand-700 bg-brand-50"
              : "border-border bg-surface-2/40 hover:border-brand-700/60 hover:bg-surface-2",
          ].join(" ")}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.xlsx"
            className="sr-only"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex w-full items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-5 w-5 shrink-0 text-brand-700" />
                <div className="min-w-0 text-left">
                  <p className="truncate text-sm font-medium text-text">
                    {file.name}
                  </p>
                  <p className="text-xs text-text-subtle">
                    {(file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
                title="Remove file"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <UploadCloud className="h-6 w-6 text-text-subtle group-hover:text-brand-700" />
              <p className="text-sm font-medium text-text">
                Drop a paystub PDF, or browse
              </p>
              <p className="text-xs text-text-subtle">
                PDF, PNG, JPG, or XLSX · max 10 MB
              </p>
            </>
          )}
        </div>

        {/* Period + kind + net controls */}
        <div className="space-y-3">
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
            <p className="text-[10px] leading-tight text-text-subtle">
              {inferred.kind === "OK"
                ? formatRange(inferred.startDate, inferred.endDate)
                : inferred.kind === "NONE"
                  ? "No schedule — dates will be blank."
                  : inferred.kind === "PENDING"
                    ? "Resolving…"
                    : "Couldn't infer; check schedule."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
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
                className="font-mono tabular-nums"
                title="Post-tax net the employee receives — this is what Zoho gets."
              />
            </div>
          </div>

          <ReadStatus state={readState} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={handleUpload} disabled={pending || !file}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          {pending ? "Uploading…" : "Upload"}
        </Button>
        {error && <span className="text-xs text-danger-700">{error}</span>}
      </div>
    </div>
  );
}

function prettyPeriodKind(periodKind: string): string {
  switch (periodKind) {
    case "WEEKLY":
      return "Weekly";
    case "BIWEEKLY":
      return "Bi-weekly";
    case "SEMI_MONTHLY":
      return "Semi-monthly";
    case "MONTHLY":
      return "Monthly";
    default:
      return periodKind;
  }
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
    <li className="flex flex-col gap-1 px-3 py-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileText className="h-4 w-4 shrink-0 text-text-subtle" />
          <div className="min-w-0">
            <p className="truncate font-medium text-text">{doc.originalFilename}</p>
            <p className="flex items-center gap-1.5 text-xs text-text-subtle">
              <span>{KIND_LABEL[doc.kind]}</span>
              {range && <span aria-hidden>·</span>}
              {range && <span>{range}</span>}
              <span aria-hidden>·</span>
              <span>uploaded {doc.uploadedAt.slice(0, 10)}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <InlineNet doc={doc} />
          <ZohoStatus doc={doc} />
          <Button asChild size="sm" variant="ghost">
            <Link
              href={`/api/payroll-docs/${doc.id}`}
              target="_blank"
              rel="noopener"
              title="View document"
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
  const editable = doc.kind === "PAYSTUB" && !doc.zohoExpenseId;
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
      <span className="font-mono tabular-nums text-xs text-text-muted">
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
          className="h-7 w-24 font-mono tabular-nums text-xs"
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
        "rounded-chip px-2 py-0.5 font-mono tabular-nums text-xs transition-colors",
        liveHasAmount
          ? "text-text hover:bg-surface-2"
          : "bg-warn-50 text-warn-700 hover:bg-warn-50/80",
      ].join(" ")}
    >
      {liveHasAmount ? formatMoney(amountCents as number) : "Add net $"}
    </button>
  );
}

function ZohoStatus({ doc }: { doc: DocLite }) {
  const [orgs, setOrgs] = React.useState<ZohoOrgChoice[] | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pushedExpenseId, setPushedExpenseId] = React.useState<string | null>(
    doc.zohoExpenseId,
  );

  // W2 docs are legal records, not expenses — no Zoho push.
  if (doc.kind === "W2") return null;

  const needsNet =
    doc.kind === "PAYSTUB" && (doc.amountCents === null || doc.amountCents <= 0);

  if (pushedExpenseId) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-chip bg-success-50 px-1.5 py-0.5 text-[10px] text-success-700"
        title={`Pushed to Zoho: expense ${pushedExpenseId}`}
      >
        <CheckCircle2 className="h-3 w-3" /> Zoho
      </span>
    );
  }

  // Without a net, the row's inline-net control prompts for one — keep
  // the Zoho affordance quiet rather than a loud warning.
  if (needsNet) {
    return (
      <span
        className="text-[10px] text-text-subtle"
        title="Add the net amount first, then push to Zoho."
      >
        Net needed
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
              setError("No active Zoho orgs. Connect one in /settings/zoho first.");
              return;
            }
            if (list.length === 1) {
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
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <PlugZap className="h-3.5 w-3.5" />
        )}{" "}
        Zoho
      </Button>
      {picking && orgs && orgs.length > 1 && (
        <div className="absolute right-0 top-full z-10 mt-1 min-w-40 rounded-card border border-border bg-surface text-xs shadow-card">
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              className="block w-full px-3 py-2 text-left hover:bg-surface-2"
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
        <span className="absolute right-0 top-full mt-1 whitespace-nowrap text-[10px] text-danger-700">
          {error}
        </span>
      )}
    </span>
  );
}
