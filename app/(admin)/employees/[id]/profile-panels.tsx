// Presentational panels for the employee page: the summary strip under the
// header and the two cards in the left rail. Pure rendering; the page
// fetches and passes plain values.

import { CalendarClock, CircleDollarSign, TrendingUp, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import {
  describeNote,
  formatIsoDate,
  type NoteEntry,
} from "@/lib/employees/profile-summary";
import { formatMoney } from "@/lib/utils";

const DASH = <span className="text-text-subtle">—</span>;

export type SummaryProps = {
  rateLabel: string;
  rateCents: number | null;
  rateUnit: string;
  /** ISO date the current rate took effect, when there is a history row. */
  rateSince: string | null;
  lastPaid: { payCents: number; periodLabel: string; hoursLabel: string } | null;
  year: number;
  ytdPayCents: number;
  ytdHoursLabel: string;
  ytdPaidCount: number;
  tenure: string;
  hiredOn: string;
};

export function EmployeeSummary(p: SummaryProps) {
  return (
    <section
      aria-label="Pay summary"
      // One column on the narrowest phones: at 320px a two-up tile is too
      // narrow for a five-figure total and the figure would be cut off.
      className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 xl:grid-cols-4"
    >
      <KpiCard
        label={p.rateLabel}
        tone="brand"
        icon={CircleDollarSign}
        value={
          p.rateCents === null ? (
            DASH
          ) : (
            <>
              {formatMoney(p.rateCents)}
              <span className="text-sm font-normal text-text-muted">{p.rateUnit}</span>
            </>
          )
        }
        context={
          p.rateCents === null
            ? "No rate set"
            : p.rateSince
              ? `Since ${formatIsoDate(p.rateSince)}`
              : "Current rate"
        }
      />
      <KpiCard
        label="Last paycheck"
        tone="brand"
        icon={Wallet}
        value={p.lastPaid ? formatMoney(p.lastPaid.payCents) : DASH}
        context={
          p.lastPaid
            ? `${p.lastPaid.periodLabel} · ${p.lastPaid.hoursLabel}`
            : "Nothing paid yet"
        }
      />
      <KpiCard
        label={`Paid in ${p.year}`}
        tone="brand"
        icon={TrendingUp}
        value={formatMoney(p.ytdPayCents)}
        context={
          p.ytdPaidCount === 0
            ? "No paychecks this year"
            : `${p.ytdPaidCount} ${p.ytdPaidCount === 1 ? "paycheck" : "paychecks"} · ${p.ytdHoursLabel}`
        }
      />
      <KpiCard
        label="Time here"
        tone="brand"
        icon={CalendarClock}
        value={p.tenure}
        context={`Hired ${formatIsoDate(p.hiredOn)}`}
      />
    </section>
  );
}

export type DetailRow = { label: string; value: React.ReactNode };

/** Label on the left, value on the right: one scannable line per fact. */
export function DetailsCard({ rows }: { rows: DetailRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className="py-1.5">
        <dl className="divide-y divide-border/60">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-baseline justify-between gap-4 py-2.5 text-sm"
            >
              <dt className="shrink-0 text-text-muted">{r.label}</dt>
              <dd className="min-w-0 truncate text-right text-text">
                {r.value ?? DASH}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function formatNoteDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timezone,
  }).format(at);
}

/** Notes as a timeline, newest first; free text keeps its line breaks. */
export function NotesCard({
  entries,
  timezone,
}: {
  entries: NoteEntry[];
  timezone: string;
}) {
  if (entries.length === 0) return null;
  const ordered = [...entries].reverse();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4 border-l border-border pl-5">
          {ordered.map((entry, i) => {
            const { title, detail } = describeNote(entry.text);
            return (
              <li key={i} className="relative">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full ${
                    i === 0 ? "bg-brand-700" : "bg-border"
                  }`}
                />
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="whitespace-pre-wrap font-medium text-text">
                    {title}
                  </span>
                  {entry.at ? (
                    <time
                      dateTime={entry.at.toISOString()}
                      className="shrink-0 text-text-muted"
                    >
                      {formatNoteDate(entry.at, timezone)}
                    </time>
                  ) : null}
                </div>
                {detail ? (
                  <p className="mt-0.5 text-xs text-text-muted">{detail}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
