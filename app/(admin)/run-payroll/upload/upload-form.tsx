"use client";

import * as React from "react";
import Link from "next/link";
import { Upload, FileText, ArrowRight, AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import type { PaySchedule } from "@/lib/db/schema";
import type { ManualImportSummary } from "@/lib/punches/manual-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  findOverlappingRunsAction,
  previewCsvAction,
  uploadCsvAction,
  type CsvPreviewEmployee,
  type OverlappingRun,
} from "./actions";

type SuccessState = { runId: string; summary: ManualImportSummary };
type PreviewState = {
  employees: CsvPreviewEmployee[];
  parseErrors: number;
  selected: Set<string>; // employeeIds selected for the run
};
type TempWorker = {
  /** Local-only key for React list reconciliation. */
  key: string;
  workerName: string;
  /** Dollars as a string in the input; converted to cents on submit. */
  amountDollars: string;
  hours: string; // optional decimal hours
  description: string;
};

export function UploadForm({ schedules }: { schedules: PaySchedule[] }) {
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<SuccessState | null>(null);
  const [pending, setPending] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewState | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [overlaps, setOverlaps] = React.useState<OverlappingRun[]>([]);
  const [confirmedOverlap, setConfirmedOverlap] = React.useState(false);
  const [tempWorkers, setTempWorkers] = React.useState<TempWorker[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Re-check overlaps whenever the date range changes meaningfully.
  React.useEffect(() => {
    if (!startDate || !endDate || startDate > endDate) {
      setOverlaps([]);
      setConfirmedOverlap(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await findOverlappingRunsAction(startDate, endDate);
      if (!cancelled) {
        setOverlaps(result);
        setConfirmedOverlap(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  // Auto-detect range from CSV. Pulls the min/max date column on a quick
  // first-pass parse — keeps the UX feeling magical without touching the
  // server.
  async function autoDetect(f: File) {
    try {
      const text = await f.text();
      const lines = text.split(/\r?\n/);
      if (lines.length < 2) return;
      const header = (lines[0] ?? "").toLowerCase().split(",").map((h) =>
        h.replace(/^"|"$/g, "").trim(),
      );
      const dateIdx = header.findIndex((h) => h === "date" || h === "punch_date" || h === "work_date");
      if (dateIdx < 0) return;
      let min: string | null = null;
      let max: string | null = null;
      for (let i = 1; i < lines.length; i++) {
        const cells = (lines[i] ?? "").split(",").map((c) => c.replace(/^"|"$/g, "").trim());
        const d = cells[dateIdx];
        if (!d) continue;
        const iso = normalizeDateForGuess(d);
        if (!iso) continue;
        if (!min || iso < min) min = iso;
        if (!max || iso > max) max = iso;
      }
      if (min) setStartDate(min);
      if (max) setEndDate(max);
    } catch {
      // best-effort; the user can fill the dates manually.
    }
  }

  function onFileChosen(f: File | null) {
    setFile(f);
    setError(null);
    if (f) void autoDetect(f);
  }

  return (
    <Card className="bg-surface-2 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4 text-brand-700" /> Drop a CSV
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={async (form) => {
            setPending(true);
            setError(null);
            setSuccess(null);
            const result = await uploadCsvAction(form);
            setPending(false);
            if ("error" in result) setError(result.error);
            else setSuccess({ runId: result.runId, summary: result.summary });
          }}
          className="space-y-4"
        >
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) {
                onFileChosen(f);
                if (fileInputRef.current) {
                  const dt = new DataTransfer();
                  dt.items.add(f);
                  fileInputRef.current.files = dt.files;
                }
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed p-10 text-center transition-colors ${
              dragOver
                ? "border-brand-700 bg-brand-50/40"
                : "border-border bg-surface hover:bg-surface-3"
            }`}
          >
            <FileText className="h-8 w-8 text-text-subtle" />
            {file ? (
              <>
                <p className="font-medium text-sm">{file.name}</p>
                <p className="text-xs text-text-muted">
                  {(file.size / 1024).toFixed(1)} KB · click to choose another
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-sm">Drag a CSV here, or click to select</p>
                <p className="text-xs text-text-muted">
                  NGTeco export shape, or any CSV with employee_id / date /
                  punch_in / punch_out columns.
                </p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              name="csv"
              accept=".csv,text/csv"
              hidden
              required
              onChange={(e) => onFileChosen(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="startDate">Period start</Label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="endDate">Period end</Label>
              <Input
                id="endDate"
                name="endDate"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="payScheduleId">Pay schedule (optional)</Label>
              <select
                id="payScheduleId"
                name="payScheduleId"
                defaultValue=""
                className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
              >
                <option value="">Unassigned</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {overlaps.length > 0 && (
            <div className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-700 shrink-0" />
                <div className="space-y-2">
                  <p className="font-medium text-amber-800">
                    A run already exists for this date range. Importing again
                    will create a second run alongside it.
                  </p>
                  <ul className="text-xs text-amber-800 space-y-0.5">
                    {overlaps.slice(0, 5).map((o) => (
                      <li key={o.runId}>
                        • {o.startDate} – {o.endDate} · <span className="font-mono">{o.source}</span> · {o.state}
                        {o.totalAmountCents
                          ? ` · $${(o.totalAmountCents / 100).toFixed(2)}`
                          : ""}
                      </li>
                    ))}
                    {overlaps.length > 5 && (
                      <li>+ {overlaps.length - 5} more</li>
                    )}
                  </ul>
                  <label className="flex items-center gap-2 text-amber-900">
                    <input
                      type="checkbox"
                      checked={confirmedOverlap}
                      onChange={(e) => setConfirmedOverlap(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Yes, proceed anyway — I&apos;m intentionally re-running this period.
                  </label>
                </div>
              </div>
            </div>
          )}
          {confirmedOverlap && (
            <input type="hidden" name="confirmDuplicate" value="1" />
          )}

          {error && <p className="text-sm text-red-700">{error}</p>}

          {preview && (
            <div className="rounded-card border border-border bg-surface-2/40 p-3 space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">
                  Employees in this CSV ({preview.employees.length})
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="text-brand-700 underline"
                    onClick={() =>
                      setPreview({
                        ...preview,
                        selected: new Set(
                          preview.employees
                            .filter((e) => e.employeeId !== null)
                            .map((e) => e.employeeId!),
                        ),
                      })
                    }
                  >
                    Select all
                  </button>
                  <span className="text-text-muted">·</span>
                  <button
                    type="button"
                    className="text-brand-700 underline"
                    onClick={() =>
                      setPreview({ ...preview, selected: new Set() })
                    }
                  >
                    Clear
                  </button>
                </div>
              </div>
              <p className="text-xs text-text-muted">
                Check the employees you want to pay for this period. Unchecked
                employees won&apos;t get a payslip even if their hours are in
                the CSV.
              </p>
              <ul className="divide-y divide-border max-h-72 overflow-y-auto rounded border border-border bg-surface">
                {preview.employees.map((e) => {
                  const isSelectable = e.employeeId !== null;
                  const isChecked =
                    e.employeeId !== null &&
                    preview.selected.has(e.employeeId);
                  return (
                    <li
                      key={e.ngtecoRef}
                      className="flex items-center gap-3 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={isChecked}
                        disabled={!isSelectable}
                        onChange={(ev) => {
                          if (!e.employeeId) return;
                          const next = new Set(preview.selected);
                          if (ev.target.checked) next.add(e.employeeId);
                          else next.delete(e.employeeId);
                          setPreview({ ...preview, selected: next });
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {e.displayName}
                          {e.unmatched && (
                            <span className="ml-2 rounded-input bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                              No match (ref: {e.ngtecoRef})
                            </span>
                          )}
                          {e.payType === "SALARIED" && (
                            <span className="ml-2 rounded-input bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-800">
                              Salaried — paystub upload only
                            </span>
                          )}
                          {e.unmatched && (
                            <Link
                              href={`/employees/new?ngtecoRef=${encodeURIComponent(e.ngtecoRef)}&displayName=${encodeURIComponent(e.displayName)}`}
                              target="_blank"
                              rel="noopener"
                              className="ml-2 text-[10px] text-brand-700 underline"
                            >
                              + Add as new
                            </Link>
                          )}
                        </p>
                        <p className="text-xs text-text-muted">
                          {e.dayCount} day{e.dayCount === 1 ? "" : "s"} · {e.totalHours.toFixed(2)} h
                          {e.payScheduleName && ` · ${e.payScheduleName}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {preview.parseErrors > 0 && (
                <p className="text-xs text-amber-700">
                  {preview.parseErrors} CSV row
                  {preview.parseErrors === 1 ? "" : "s"} couldn&apos;t be
                  parsed. They&apos;ll be logged as ingest exceptions on the
                  run.
                </p>
              )}
              <input
                type="hidden"
                name="cohortJson"
                value={JSON.stringify([...preview.selected])}
              />
            </div>
          )}

          {/* Temp / manual labor — only when a preview exists, since
              that's when we know the period dates + cohort are real.
              Each row contributes a temp_worker_entries row scoped to
              the new period. */}
          {preview && (
            <div className="space-y-2 rounded-card border border-border bg-surface-2/40 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">Temp / manual labor</h3>
                  <p className="text-xs text-text-muted">
                    One-off contractors, day-labor, or anyone paid this period
                    who isn&apos;t in the CSV.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setTempWorkers((prev) => [
                      ...prev,
                      {
                        key: `tw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                        workerName: "",
                        amountDollars: "",
                        hours: "",
                        description: "",
                      },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> Add temp worker
                </Button>
              </div>
              {tempWorkers.length === 0 ? (
                <p className="text-xs text-text-subtle">
                  None added.
                </p>
              ) : (
                <div className="space-y-2">
                  {tempWorkers.map((tw, i) => (
                    <div
                      key={tw.key}
                      className="grid grid-cols-1 sm:grid-cols-[1.6fr_0.7fr_0.7fr_2fr_auto] gap-2 items-end"
                    >
                      <div className="space-y-0.5">
                        {i === 0 && (
                          <Label htmlFor={`tw-name-${tw.key}`} className="text-[10px] uppercase tracking-wide text-text-subtle">
                            Worker
                          </Label>
                        )}
                        <Input
                          id={`tw-name-${tw.key}`}
                          value={tw.workerName}
                          onChange={(e) =>
                            setTempWorkers((prev) =>
                              prev.map((x) =>
                                x.key === tw.key ? { ...x, workerName: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Chintu"
                          className="h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-0.5">
                        {i === 0 && (
                          <Label htmlFor={`tw-amount-${tw.key}`} className="text-[10px] uppercase tracking-wide text-text-subtle">
                            Amount $
                          </Label>
                        )}
                        <Input
                          id={`tw-amount-${tw.key}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={tw.amountDollars}
                          onChange={(e) =>
                            setTempWorkers((prev) =>
                              prev.map((x) =>
                                x.key === tw.key ? { ...x, amountDollars: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="200.00"
                          className="h-9 text-sm font-mono"
                        />
                      </div>
                      <div className="space-y-0.5">
                        {i === 0 && (
                          <Label htmlFor={`tw-hours-${tw.key}`} className="text-[10px] uppercase tracking-wide text-text-subtle">
                            Hours (opt)
                          </Label>
                        )}
                        <Input
                          id={`tw-hours-${tw.key}`}
                          type="number"
                          step="0.01"
                          min="0"
                          value={tw.hours}
                          onChange={(e) =>
                            setTempWorkers((prev) =>
                              prev.map((x) =>
                                x.key === tw.key ? { ...x, hours: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="—"
                          className="h-9 text-sm font-mono"
                        />
                      </div>
                      <div className="space-y-0.5">
                        {i === 0 && (
                          <Label htmlFor={`tw-desc-${tw.key}`} className="text-[10px] uppercase tracking-wide text-text-subtle">
                            Description
                          </Label>
                        )}
                        <Input
                          id={`tw-desc-${tw.key}`}
                          value={tw.description}
                          onChange={(e) =>
                            setTempWorkers((prev) =>
                              prev.map((x) =>
                                x.key === tw.key ? { ...x, description: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Loading dock day labor"
                          className="h-9 text-sm"
                        />
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setTempWorkers((prev) => prev.filter((x) => x.key !== tw.key))
                        }
                        className="h-9 text-danger-700 hover:bg-danger-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {/* Hidden serialized payload for the action. Filtered to
                  rows that actually have a name + amount, so empty
                  scaffolding rows don't insert. */}
              <input
                type="hidden"
                name="tempWorkersJson"
                value={JSON.stringify(
                  tempWorkers
                    .filter((t) => t.workerName.trim() && Number(t.amountDollars) > 0)
                    .map((t) => ({
                      workerName: t.workerName.trim(),
                      amountCents: Math.round(Number(t.amountDollars) * 100),
                      hours: t.hours ? Number(t.hours) : null,
                      description: t.description.trim() || null,
                    })),
                )}
              />
            </div>
          )}

          {success && (
            <div className="rounded-card border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                <div className="space-y-2">
                  <p className="font-medium text-emerald-800">
                    Import complete.{" "}
                    {success.summary.punchesImported > 0
                      ? `Added ${success.summary.punchesImported} new punch${success.summary.punchesImported === 1 ? "" : "es"}.`
                      : success.summary.punchesMoved > 0
                        ? `Moved ${success.summary.punchesMoved} existing punch${success.summary.punchesMoved === 1 ? "" : "es"} into this period.`
                        : "No new punches were added."}
                  </p>
                  <ul className="space-y-0.5 text-xs text-emerald-900">
                    {success.summary.punchesMoved > 0 && (
                      <li>
                        • {success.summary.punchesMoved} punch
                        {success.summary.punchesMoved === 1 ? "" : "es"} re-pointed
                        from a different period — your CSV is now the source of truth.
                      </li>
                    )}
                    {success.summary.payslipsVoidedFromMove > 0 && (
                      <li>
                        • {success.summary.payslipsVoidedFromMove} payslip
                        {success.summary.payslipsVoidedFromMove === 1 ? "" : "s"}{" "}
                        on the source period{success.summary.payslipsVoidedFromMove === 1 ? "" : "s"}{" "}
                        voided so totals recompute. Re-publish those runs if needed.
                      </li>
                    )}
                    {success.summary.duplicates > 0 && (
                      <li>
                        • {success.summary.duplicates} duplicate
                        {success.summary.duplicates === 1 ? " was" : "s were"}{" "}
                        already in the system and {success.summary.duplicates === 1 ? "was" : "were"}{" "}
                        skipped.
                      </li>
                    )}
                    {success.summary.unmatched > 0 && (
                      <li>
                        • {success.summary.unmatched} row
                        {success.summary.unmatched === 1 ? "" : "s"} couldn&apos;t
                        be matched to an employee. Check the run detail.
                      </li>
                    )}
                    {success.summary.parseErrors > 0 && (
                      <li>
                        • {success.summary.parseErrors} parse error
                        {success.summary.parseErrors === 1 ? "" : "s"} —
                        review the run detail.
                      </li>
                    )}
                  </ul>
                  {success.summary.punchesImported === 0 &&
                    success.summary.duplicates > 0 && (
                      <p className="text-xs text-emerald-900">
                        Every punch in this CSV was already imported (likely by
                        the NGTeco scrape). The run was created but contains
                        no new data; you can cancel it from the detail page.
                      </p>
                    )}
                  <Button asChild size="sm">
                    <Link href={`/payroll/run/${success.runId}`}>
                      Open run <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={previewing || !file}
              onClick={async () => {
                if (!file) return;
                setPreviewing(true);
                setError(null);
                const fd = new FormData();
                fd.set("csv", file);
                const r = await previewCsvAction(fd);
                setPreviewing(false);
                if ("error" in r) {
                  setError(r.error);
                  return;
                }
                // Default selection: every matched, non-salaried employee.
                const defaults = new Set(
                  r.employees
                    .filter((e) => e.employeeId && e.payType !== "SALARIED")
                    .map((e) => e.employeeId!),
                );
                setPreview({
                  employees: r.employees,
                  parseErrors: r.parseErrors,
                  selected: defaults,
                });
              }}
            >
              {previewing ? "Reading CSV…" : "Preview CSV"}
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                !file ||
                (overlaps.length > 0 && !confirmedOverlap) ||
                (preview !== null && preview.selected.size === 0)
              }
            >
              {pending
                ? "Importing…"
                : preview
                  ? `Generate payslips for ${preview.selected.size} selected`
                  : "Import & open run"}{" "}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function normalizeDateForGuess(s: string): string | null {
  const trimmed = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(trimmed);
  if (us) {
    const m = us[1]!.padStart(2, "0");
    const d = us[2]!.padStart(2, "0");
    const y = us[3]!.length === 2 ? `20${us[3]}` : us[3]!;
    return `${y}-${m}-${d}`;
  }
  return null;
}
