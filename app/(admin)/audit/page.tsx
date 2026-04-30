// Owner-only audit log viewer.
// Phase 1 ships the basics: paginated by id-cursor, filterable by actor +
// targetType. Full search (date range, action keyword, before/after diff)
// lands in Phase 6.

import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";
import { requireOwner } from "@/lib/auth-guards";
import { listAudit } from "@/lib/db/queries/audit";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type SearchParams = Promise<{
  before?: string;
  actor?: string;
  type?: string;
}>;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireOwner();
  const params = await searchParams;
  const beforeNum = params.before ? Number.parseInt(params.before, 10) : undefined;
  const rows = await listAudit({
    ...(Number.isFinite(beforeNum) ? { before: beforeNum as number } : {}),
    ...(params.actor ? { actorId: params.actor } : {}),
    ...(params.type ? { targetType: params.type } : {}),
    limit: 100,
  });

  const oldest = rows[rows.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="text-sm text-[--text-muted]">
            Owner-only. Newest first. Showing {rows.length}.
          </p>
        </div>
        {(params.before || params.actor || params.type) && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/audit">
              <ArrowLeft className="h-4 w-4" /> Reset
            </Link>
          </Button>
        )}
      </div>

      <form
        method="GET"
        action="/audit"
        className="flex flex-wrap items-end gap-2 rounded-[--radius-card] border border-[--border] bg-[--surface] p-3 text-sm"
      >
        <input
          name="actor"
          defaultValue={params.actor ?? ""}
          placeholder="Actor user id"
          className="h-9 w-72 rounded-[--radius-input] border border-[--border] bg-[--surface] px-3"
        />
        <input
          name="type"
          defaultValue={params.type ?? ""}
          placeholder="Target type (Employee, Shift, …)"
          className="h-9 w-56 rounded-[--radius-input] border border-[--border] bg-[--surface] px-3"
        />
        <Button type="submit" size="sm" variant="secondary">
          Apply
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit rows match"
          description="Adjust filters or wait — every mutation produces a row."
        />
      ) : (
        <div className="overflow-x-auto rounded-[--radius-card] border border-[--border] bg-[--surface]">
          <table className="min-w-full text-xs">
            <thead className="sticky top-0 bg-[--surface-2] text-left text-[--text-muted]">
              <tr>
                <th className="p-2 font-medium">When</th>
                <th className="p-2 font-medium">Action</th>
                <th className="p-2 font-medium">Target</th>
                <th className="p-2 font-medium">Actor</th>
                <th className="p-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[--border]">
                  <td className="p-2 font-mono">
                    {r.createdAt.toISOString().replace("T", " ").slice(0, 19)}Z
                  </td>
                  <td className="p-2">{r.action}</td>
                  <td className="p-2">
                    {r.targetType}
                    <span className="ml-1 text-[--text-muted]">{r.targetId}</span>
                  </td>
                  <td className="p-2">
                    {r.actorRole ?? "—"}
                    {r.actorId ? (
                      <span className="ml-1 text-[--text-muted]">
                        {r.actorId.slice(0, 8)}…
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2 text-[--text-muted]">{r.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {oldest && (
        <div className="flex justify-end">
          <Button asChild size="sm" variant="secondary">
            <Link
              href={`/audit?before=${oldest.id}${params.actor ? `&actor=${params.actor}` : ""}${
                params.type ? `&type=${params.type}` : ""
              }`}
            >
              Older
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
