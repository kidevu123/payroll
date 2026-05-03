"use client";

import * as React from "react";
import Link from "next/link";
import {
  Download,
  Eye,
  Send,
  Trash2,
  CheckCircle2,
  CircleDot,
} from "lucide-react";
import type { ReportRow } from "@/lib/db/queries/payroll-runs";
import type { ZohoOrganization } from "@/lib/db/schema";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/domain/money-display";
import {
  deleteReportAction,
  publishReportAction,
  pushReportToZohoAction,
} from "./actions";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRange(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return "—";
  const a = new Date(`${startIso}T12:00:00Z`);
  const b = new Date(`${endIso}T12:00:00Z`);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const left = `${MONTH_SHORT[a.getUTCMonth()]} ${String(a.getUTCDate()).padStart(2, "0")}${sameYear ? "" : `, ${a.getUTCFullYear()}`}`;
  const right = `${MONTH_SHORT[b.getUTCMonth()]} ${String(b.getUTCDate()).padStart(2, "0")}, ${b.getUTCFullYear()}`;
  return `${left} – ${right}`;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  const dt = d instanceof Date ? d : new Date(d);
  return `${MONTH_SHORT[dt.getMonth()]} ${String(dt.getDate()).padStart(2, "0")}, ${dt.getFullYear()}`;
}

export function ReportsTable({
  reports,
  zohoOrgs,
}: {
  reports: ReportRow[];
  zohoOrgs: ZohoOrganization[];
}) {
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const haute = zohoOrgs.find((o) => /haute/i.test(o.name));
  const boomin = zohoOrgs.find((o) => /boomin/i.test(o.name));

  async function onPush(reportId: string, orgId: string | undefined, orgLabel: string) {
    if (!orgId) {
      setError(`Connect "${orgLabel}" in /settings/zoho first.`);
      return;
    }
    setBusyId(`${reportId}:push:${orgId}`);
    setError(null);
    const result = await pushReportToZohoAction(reportId, orgId);
    setBusyId(null);
    if (result?.error) setError(result.error);
  }

  async function onDelete(id: string) {
    setBusyId(`${id}:delete`);
    setError(null);
    const result = await deleteReportAction(id);
    setBusyId(null);
    setConfirmDelete(null);
    if (result?.error) setError(result.error);
  }

  async function onPublish(id: string) {
    setBusyId(`${id}:publish`);
    setError(null);
    const result = await publishReportAction(id);
    setBusyId(null);
    if (result?.error) setError(result.error);
  }

  if (reports.length === 0) {
    return (
      <div className="rounded-card border border-border bg-surface-2 p-10 text-center text-sm text-text-muted shadow-sm">
        No payroll runs yet. They appear here once a run completes (cron, manual
        upload, or legacy import).
      </div>
    );
  }

  return (
    <div className="rounded-card border border-border bg-surface-2 shadow-sm">
      {error && (
        <div className="border-b border-border bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
            <tr>
              <th className="py-2 pl-4 pr-3 font-medium">Run</th>
              <th className="py-2 px-3 font-medium text-right">Amount</th>
              <th className="py-2 px-3 font-medium">Schedule</th>
              <th className="py-2 px-3 font-medium">Created by</th>
              <th className="py-2 px-3 font-medium">Posted</th>
              <th className="py-2 px-3 font-medium">Visibility</th>
              <th className="py-2 px-3 font-medium text-right pr-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {reports.map((r, idx) => {
              const pushedHaute = r.zohoPushes.find((p) => p.orgId === haute?.id);
              const pushedBoomin = r.zohoPushes.find((p) => p.orgId === boomin?.id);
              const published = r.publishedToPortalAt !== null;
              const isLegacy = r.source === "LEGACY_IMPORT";
              const prev = idx > 0 ? reports[idx - 1] : null;
              const newPeriod = prev?.periodId !== r.periodId;
              // Sum every run row that shares this period (they're already
              // adjacent because listReports orders by post date and runs
              // for one period almost always cluster). For perfect group
              // totals across mis-ordered rows we'd need a pre-pass, but
              // the temp_labor_cents field is already per-period so the
              // grand total below is correct regardless.
              const periodGrandTotal = sumPeriodRuns(reports, r.periodId);
              return (
                <React.Fragment key={r.id}>
                  {newPeriod && (
                    <tr className="bg-surface-3 border-t-[3px] border-brand-700/30">
                      <td colSpan={7} className="px-4 py-2.5">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-baseline gap-3">
                            <span className="font-semibold text-text whitespace-nowrap">
                              {formatRange(r.startDate, r.endDate)}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider text-text-subtle">
                              Period total
                            </span>
                          </div>
                          <div className="flex items-baseline gap-3 text-right whitespace-nowrap">
                            <span className="font-mono tabular-nums font-semibold text-text">
                              <MoneyDisplay cents={periodGrandTotal} />
                            </span>
                            {r.tempLaborCents > 0 && (
                              <span className="text-[10px] text-text-muted">
                                incl. <MoneyDisplay cents={r.tempLaborCents} monospace={false} /> temp
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                <tr className="hover:bg-surface/40 transition-colors">
                  <td className="py-2 pl-8 pr-3 whitespace-nowrap">
                    <Link
                      href={`/payroll/${r.periodId}`}
                      className="text-sm text-text hover:text-brand-700 hover:underline underline-offset-2 inline-flex items-baseline gap-1.5"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
                        {r.source.replace(/_/g, " ")}
                      </span>
                      <span className="text-text-subtle">·</span>
                      <span className="font-mono text-xs">{r.id.slice(0, 8)}</span>
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-text whitespace-nowrap">
                    <MoneyDisplay cents={r.amountCents} />
                    {r.tempLaborCents > 0 && (
                      <div className="text-[10px] font-normal text-text-muted">
                        + <MoneyDisplay cents={r.tempLaborCents} monospace={false} /> temp
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-text-muted whitespace-nowrap">
                    {r.scheduleName ?? <span className="italic">unassigned</span>}
                  </td>
                  <td className="py-2 px-3 text-text-muted whitespace-nowrap">{r.createdByDisplay}</td>
                  <td className="py-2 px-3 text-text-muted whitespace-nowrap">{formatDate(r.postedAt)}</td>
                  <td className="py-3 px-3">
                    {published ? (
                      <span className="inline-flex items-center gap-1.5 rounded-input bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" /> Published
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-input bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <CircleDot className="h-3 w-3" /> Internal
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3 pr-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        title="Open admin report"
                      >
                        <Link href={`/payroll/${r.periodId}`}>
                          <Eye className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      {r.pdfPath ? (
                        <Button
                          asChild
                          size="sm"
                          variant="ghost"
                          title="Download report file"
                        >
                          <Link
                            href={`/api/reports/${r.id}/pdf`}
                            target="_blank"
                            rel="noopener"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled title="No PDF">
                          <Download className="h-3.5 w-3.5 opacity-30" />
                        </Button>
                      )}
                      {!published && !isLegacy && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Publish to employee portal"
                          disabled={busyId === `${r.id}:publish`}
                          onClick={() => onPublish(r.id)}
                        >
                          {busyId === `${r.id}:publish` ? "…" : "Publish"}
                        </Button>
                      )}
                      <PushPill
                        label="Haute"
                        pushed={pushedHaute}
                        busy={busyId === `${r.id}:push:${haute?.id ?? ""}`}
                        onClick={() => onPush(r.id, haute?.id, "Haute")}
                      />
                      <PushPill
                        label="Boomin"
                        pushed={pushedBoomin}
                        busy={busyId === `${r.id}:push:${boomin?.id ?? ""}`}
                        onClick={() => onPush(r.id, boomin?.id, "Boomin")}
                      />
                      {confirmDelete === r.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDelete(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === `${r.id}:delete`}
                            onClick={() => onDelete(r.id)}
                            className="text-red-700"
                          >
                            {busyId === `${r.id}:delete` ? "…" : "Confirm"}
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Delete report"
                          onClick={() => setConfirmDelete(r.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sumPeriodRuns(reports: ReportRow[], periodId: string): number {
  let total = 0;
  let temp = 0;
  for (const r of reports) {
    if (r.periodId === periodId) {
      total += r.amountCents;
      temp = r.tempLaborCents; // same value across rows in this period
    }
  }
  return total + temp;
}

function PushPill({
  label,
  pushed,
  busy,
  onClick,
}: {
  label: string;
  pushed: ReportRow["zohoPushes"][number] | undefined;
  busy: boolean;
  onClick: () => void;
}) {
  if (pushed) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-input bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
        title={`Expense ${pushed.expenseId ?? "—"}`}
      >
        <CheckCircle2 className="h-3 w-3" /> {label}
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      title={`Push to ${label}`}
      disabled={busy}
      onClick={onClick}
      className="text-xs"
    >
      <Send className="h-3 w-3" /> {label}
    </Button>
  );
}
