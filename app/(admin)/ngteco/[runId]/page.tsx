import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/domain/status-pill";
import { getRun, listExceptions } from "@/lib/db/queries/payroll-runs";
import { getPeriodById } from "@/lib/db/queries/pay-periods";

export default async function NgtecoRunDetail({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await getRun(runId);
  if (!run) notFound();
  const [period, exceptions] = await Promise.all([
    getPeriodById(run.periodId),
    listExceptions(runId),
  ]);
  const grouped = {
    UNMATCHED_REF: exceptions.filter((e) => e.type === "UNMATCHED_REF"),
    DUPLICATE_HASH: exceptions.filter((e) => e.type === "DUPLICATE_HASH"),
    PARSE_ERROR: exceptions.filter((e) => e.type === "PARSE_ERROR"),
  };

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/ngteco">
          <ArrowLeft className="h-4 w-4" /> All runs
        </Link>
      </Button>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold font-mono">{run.id}</h1>
        <StatusPill status={run.state as never} />
      </div>
      <p className="text-sm text-[--text-muted]">
        Period {period?.startDate} – {period?.endDate}
      </p>

      {run.lastError && (
        <Card>
          <CardHeader>
            <CardTitle>Last error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xs whitespace-pre-wrap">{run.lastError}</p>
            {run.ingestScreenshotPath && (
              <p className="mt-2 text-xs text-[--text-muted]">
                Screenshot on the LXC: <span className="font-mono">{run.ingestScreenshotPath}</span>
              </p>
            )}
            {run.ingestLogPath && (
              <p className="text-xs text-[--text-muted]">
                Page HTML: <span className="font-mono">{run.ingestLogPath}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ExceptionCard
          title="Unmatched refs"
          subtitle="Bind to an Employee in /employees to resolve."
          rows={grouped.UNMATCHED_REF}
        />
        <ExceptionCard
          title="Duplicate hashes"
          subtitle="Already imported in a prior run."
          rows={grouped.DUPLICATE_HASH}
        />
        <ExceptionCard
          title="Parse errors"
          subtitle="Row decoding failed; see raw_data."
          rows={grouped.PARSE_ERROR}
        />
      </div>
    </div>
  );
}

function ExceptionCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: { id: string; ngtecoEmployeeRef: string | null; rawData: unknown }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {title}{" "}
          <span className="text-sm font-normal text-[--text-muted]">{rows.length}</span>
        </CardTitle>
        <p className="text-xs text-[--text-muted]">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {rows.length === 0 ? (
          <p className="text-xs text-[--text-muted]">None.</p>
        ) : (
          rows.slice(0, 8).map((r) => (
            <div
              key={r.id}
              className="rounded-[--radius-input] border border-[--border] bg-[--surface-2]/50 px-2 py-1 text-xs"
            >
              <span className="font-mono">{r.ngtecoEmployeeRef ?? "(no ref)"}</span>
            </div>
          ))
        )}
        {rows.length > 8 && (
          <p className="text-xs text-[--text-muted]">
            +{rows.length - 8} more.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
