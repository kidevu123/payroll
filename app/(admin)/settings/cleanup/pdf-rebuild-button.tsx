"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  rebuildFromBakedSeedAction,
  rebuildFromPdfJsonAction,
} from "./actions";

/**
 * Owner-only paste-and-rebuild surface. The user pastes the JSON dump
 * from the parser agents into the textarea, hits "Rebuild", and the
 * server action wipes + replaces all matching periods. Each period is
 * processed in its own transaction; failures on one period don't roll
 * back the others.
 */
export function PdfRebuildButton() {
  const [json, setJson] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<
    Awaited<ReturnType<typeof rebuildFromPdfJsonAction>> | null
  >(null);

  async function onSubmit() {
    if (!json.trim()) return;
    const ok = window.confirm(
      "Wipe + replace ALL pay periods listed in this JSON with PDF data?\n\n" +
        "For each period: existing payslips/runs/punches/temp/docs are deleted; " +
        "fresh punches and a single PUBLISHED run are created from the PDF; " +
        "the period is marked PAID.\n\nIrreversible. Audited per period.",
    );
    if (!ok) return;
    setPending(true);
    setResult(null);
    const r = await rebuildFromPdfJsonAction({ json });
    setPending(false);
    setResult(r);
  }

  async function onSubmitBaked() {
    const ok = window.confirm(
      "Wipe + replace ALL pay periods covered by the BAKED seed (lib/payroll/pdf-rebuild-seed.json) with PDF data?\n\n" +
        "For each period: existing payslips/runs/punches/temp/docs are deleted; " +
        "fresh punches and a single PUBLISHED run are created from the PDF; " +
        "the period is marked PAID.\n\nIrreversible. Audited per period.",
    );
    if (!ok) return;
    setPending(true);
    setResult(null);
    const r = await rebuildFromBakedSeedAction();
    setPending(false);
    setResult(r);
  }

  return (
    <section className="rounded-card border border-border bg-surface-2 p-4 space-y-3">
      <div>
        <h2 className="text-heading font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-brand-700" />
          Rebuild periods from PDF JSON
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          Paste the consolidated JSON output from the PDF parser agents
          below. Each period is wiped + replaced with the PDF&apos;s data.
          Punches are reconstructed from per-day in/out times and the
          period is automatically marked PAID. Use this to rebuild
          payroll history end-to-end. Owner-only, audited per period.
        </p>
      </div>
      <textarea
        className="w-full h-48 rounded-input border border-border bg-surface px-3 py-2 text-xs font-mono"
        placeholder='[{"filename":"admin_report_2026-04-27.pdf","printedPeriod":{"start":"2026-04-27","end":"2026-05-01"},"employees":[...],"tempWorkers":[]}, ...]'
        value={json}
        onChange={(e) => setJson(e.target.value)}
        disabled={pending}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="default"
          disabled={pending || !json.trim()}
          onClick={onSubmit}
        >
          {pending ? "Rebuilding…" : "Rebuild from pasted JSON"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={onSubmitBaked}
          title="Use the JSON file checked in at lib/payroll/pdf-rebuild-seed.json (parsed from the legacy admin-report PDFs)."
        >
          {pending ? "Rebuilding…" : "Rebuild from baked seed"}
        </Button>
        <span className="text-xs text-text-muted">
          {json.trim().length > 0
            ? `${(json.length / 1024).toFixed(1)} KB pasted`
            : "Paste JSON or use baked seed"}
        </span>
      </div>
      {result && "error" in result && result.error && (
        <div className="rounded-input border border-danger-200 bg-danger-50 p-3 text-xs text-danger-700">
          <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
          {result.error}
        </div>
      )}
      {result && "result" in result && result.result && (
        <div className="rounded-input border border-success-200 bg-success-50 p-3 text-xs text-success-900 space-y-1">
          <p className="font-medium">
            <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
            Rebuilt {result.result.periodsProcessed} period
            {result.result.periodsProcessed === 1 ? "" : "s"}.
          </p>
          <ul className="space-y-0.5 ml-4">
            <li>{result.result.periodsCreated} created</li>
            <li>{result.result.periodsReplaced} replaced</li>
            <li>{result.result.payslipsWritten} payslips written</li>
            <li>{result.result.punchesWritten} punches written</li>
            <li>{result.result.tempWorkersWritten} temp workers written</li>
          </ul>
          {result.result.unmatchedEmployees.length > 0 && (
            <div className="mt-2 border-t border-success-200 pt-2">
              <p className="font-medium text-warning-700">
                {result.result.unmatchedEmployees.length} unmatched employees
                (no Employee row by personId or name):
              </p>
              <ul className="ml-4 space-y-0.5">
                {result.result.unmatchedEmployees.slice(0, 10).map((u, i) => (
                  <li key={i}>
                    #{u.personId} {u.name} (period {u.period})
                  </li>
                ))}
                {result.result.unmatchedEmployees.length > 10 && (
                  <li>
                    …{result.result.unmatchedEmployees.length - 10} more
                  </li>
                )}
              </ul>
              <p className="mt-1 text-warning-700">
                Add these as employees with matching legacy_id, then re-run.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
