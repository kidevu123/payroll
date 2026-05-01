// Owner-only audit log viewer. Phase 6 polish: date-range, action keyword,
// inline before/after diff expansion.

import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";
import { requireOwner } from "@/lib/auth-guards";
import { listAudit } from "@/lib/db/queries/audit";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AuditRowDiff } from "./row-diff";

type SearchParams = Promise<{
  before?: string;
  actor?: string;
  type?: string;
  action?: string;
  from?: string;
  to?: string;
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
    ...(params.action ? { actionLike: params.action } : {}),
    ...(params.from ? { fromDate: params.from } : {}),
    ...(params.to ? { toDate: params.to } : {}),
    limit: 100,
  });

  const oldest = rows[rows.length - 1];

  const filterQs = (extra?: Record<string, string>): string => {
    const u = new URLSearchParams();
    if (params.actor) u.set("actor", params.actor);
    if (params.type) u.set("type", params.type);
    if (params.action) u.set("action", params.action);
    if (params.from) u.set("from", params.from);
    if (params.to) u.set("to", params.to);
    if (extra) for (const [k, v] of Object.entries(extra)) u.set(k, v);
    return u.toString();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="text-sm text-text-muted">
            Owner-only. Newest first. Showing {rows.length}.
          </p>
        </div>
        {(params.before || params.actor || params.type || params.action || params.from || params.to) && (
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
        className="grid grid-cols-1 md:grid-cols-6 gap-2 rounded-card border border-border bg-surface p-3 text-sm"
      >
        <input
          name="actor"
          defaultValue={params.actor ?? ""}
          placeholder="Actor user id"
          className="h-9 md:col-span-2 rounded-input border border-border bg-surface px-3"
        />
        <input
          name="type"
          defaultValue={params.type ?? ""}
          placeholder="Target type (Employee, Shift, …)"
          className="h-9 rounded-input border border-border bg-surface px-3"
        />
        <input
          name="action"
          defaultValue={params.action ?? ""}
          placeholder="Action keyword"
          className="h-9 rounded-input border border-border bg-surface px-3"
        />
        <input
          name="from"
          type="date"
          defaultValue={params.from ?? ""}
          className="h-9 rounded-input border border-border bg-surface px-3"
        />
        <input
          name="to"
          type="date"
          defaultValue={params.to ?? ""}
          className="h-9 rounded-input border border-border bg-surface px-3"
        />
        <div className="md:col-span-6 flex justify-end gap-2">
          <Button type="submit" size="sm" variant="secondary">
            Apply
          </Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit rows match"
          description="Adjust filters or wait — every mutation produces a row."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <AuditRowDiff
              key={r.id}
              when={r.createdAt.toISOString().replace("T", " ").slice(0, 19) + "Z"}
              action={r.action}
              targetType={r.targetType}
              targetId={r.targetId}
              actorRole={r.actorRole}
              actorId={r.actorId}
              ip={r.ip}
              before={r.before}
              after={r.after}
            />
          ))}
        </div>
      )}

      {oldest && (
        <div className="flex justify-end">
          <Button asChild size="sm" variant="secondary">
            <Link href={`/audit?${filterQs({ before: String(oldest.id) })}`}>
              Older
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
