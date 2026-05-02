// /db — owner-only read-only DB browser. Use this when you need to peek
// at raw row data and don't want to ssh into the LXC. No mutations.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Database, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireOwner } from "@/lib/auth-guards";
import { listTablesAction, selectTableAction } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = {
  table?: string;
  offset?: string;
  limit?: string;
};

export default async function DbBrowserPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireOwner();
  const sp = await searchParams;
  const tableName = sp.table ?? null;
  const offset = Math.max(parseInt(sp.offset ?? "0", 10) || 0, 0);
  const limit = Math.min(Math.max(parseInt(sp.limit ?? "50", 10) || 50, 1), 500);

  const tablesResult = await listTablesAction();
  if ("error" in tablesResult) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Database</h1>
        <div className="rounded-card border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700">
          <AlertTriangle className="inline h-4 w-4 mr-1" /> {tablesResult.error}
        </div>
      </div>
    );
  }
  const tables = tablesResult.tables;

  let selected:
    | Awaited<ReturnType<typeof selectTableAction>>
    | null = null;
  if (tableName) {
    selected = await selectTableAction(tableName, { limit, offset });
    // If the table param doesn't match anything, 404 instead of silently
    // showing the empty state — easier to spot a bad URL.
    if ("error" in selected && selected.error === "Unknown table.") notFound();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Database className="h-6 w-6 text-brand-700" /> Database
          </h1>
          <p className="text-sm text-text-muted">
            Read-only view of every table. Owner-only · no edits possible from
            here.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* Table list */}
        <nav
          aria-label="Tables"
          className="rounded-card border border-border bg-surface lg:sticky lg:top-4 self-start max-h-[80vh] overflow-y-auto"
        >
          <ul className="divide-y divide-border text-sm">
            {tables.map((t) => {
              const active = t.name === tableName;
              return (
                <li key={t.name}>
                  <Link
                    href={`/db?table=${encodeURIComponent(t.name)}`}
                    className={`flex items-center justify-between gap-2 px-3 py-2 ${
                      active
                        ? "bg-brand-50 text-brand-700 font-medium"
                        : "text-text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    <span className="font-mono text-xs truncate">{t.name}</span>
                    <span className="text-[10px] tabular-nums shrink-0 text-text-subtle">
                      {t.rowCount.toLocaleString()}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Table contents */}
        <section>
          {!tableName ? (
            <div className="rounded-card border border-dashed border-border bg-surface-2/30 p-8 text-center text-sm text-text-muted">
              Select a table on the left to view rows.
            </div>
          ) : !selected || "error" in selected ? (
            <div className="rounded-card border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700">
              <AlertTriangle className="inline h-4 w-4 mr-1" />
              {selected && "error" in selected ? selected.error : "Failed to load table."}
            </div>
          ) : (
            <TableViewer
              tableName={tableName}
              columns={selected.columns}
              rows={selected.rows}
              total={selected.total}
              offset={offset}
              limit={limit}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function TableViewer({
  tableName,
  columns,
  rows,
  total,
  offset,
  limit,
}: {
  tableName: string;
  columns: { name: string; dataType: string; isNullable: boolean }[];
  rows: Record<string, unknown>[];
  total: number;
  offset: number;
  limit: number;
}) {
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + rows.length, total);
  const prevOffset = Math.max(offset - limit, 0);
  const nextOffset = offset + limit;
  const hasPrev = offset > 0;
  const hasNext = nextOffset < total;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-mono text-sm">{tableName}</h2>
          <p className="text-xs text-text-muted">
            {total.toLocaleString()} rows · showing {start}-{end} ·{" "}
            {columns.length} columns
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" disabled={!hasPrev}>
            <Link
              href={`/db?table=${encodeURIComponent(tableName)}&offset=${prevOffset}&limit=${limit}`}
              aria-disabled={!hasPrev}
              className={!hasPrev ? "pointer-events-none opacity-50" : ""}
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" disabled={!hasNext}>
            <Link
              href={`/db?table=${encodeURIComponent(tableName)}&offset=${nextOffset}&limit=${limit}`}
              aria-disabled={!hasNext}
              className={!hasNext ? "pointer-events-none opacity-50" : ""}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-card border border-border bg-surface max-h-[70vh]">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-surface-2 text-left text-[10px] uppercase tracking-wider text-text-subtle border-b border-border">
            <tr>
              {columns.map((c) => (
                <th key={c.name} className="px-2 py-2 font-medium whitespace-nowrap">
                  <div>{c.name}</div>
                  <div className="text-[9px] normal-case font-normal text-text-subtle">
                    {c.dataType}
                    {c.isNullable ? "?" : ""}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length || 1}
                  className="p-6 text-center text-text-muted"
                >
                  No rows.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="hover:bg-surface-2/40">
                  {columns.map((c) => (
                    <td
                      key={c.name}
                      className="px-2 py-1 align-top whitespace-nowrap max-w-[24rem] truncate"
                      title={formatCellTitle(r[c.name])}
                    >
                      {formatCell(r[c.name])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function formatCellTitle(v: unknown): string {
  const s = formatCell(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}
