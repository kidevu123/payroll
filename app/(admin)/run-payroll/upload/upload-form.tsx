"use client";

import * as React from "react";
import { Upload, FileText, ArrowRight, AlertTriangle } from "lucide-react";
import type { PaySchedule } from "@/lib/db/schema";
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
  uploadCsvAction,
  type OverlappingRun,
} from "./actions";

export function UploadForm({ schedules }: { schedules: PaySchedule[] }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [overlaps, setOverlaps] = React.useState<OverlappingRun[]>([]);
  const [confirmedOverlap, setConfirmedOverlap] = React.useState(false);
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
            const result = await uploadCsvAction(form);
            setPending(false);
            if (result?.error) setError(result.error);
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

          <div className="flex items-center justify-end">
            <Button
              type="submit"
              disabled={
                pending || !file || (overlaps.length > 0 && !confirmedOverlap)
              }
            >
              {pending ? "Importing…" : "Import & open run"} <ArrowRight className="h-4 w-4" />
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
