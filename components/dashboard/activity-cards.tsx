// Third-row dark cards: Pending requests, Recent runs, Today (attendance
// buckets). Presentational — receives already-shaped serializable props from
// the dashboard RSC page. Links preserve real navigation.

import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock4,
  FileClock,
  Plane,
  UserX,
} from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { DashCard, Eyebrow } from "./dash-primitives";
import { DASH } from "./theme";

// ── Pending requests ─────────────────────────────────────────────────────────

export type PendingItem = {
  id: string;
  kind: "MISSED_PUNCH" | "TIME_OFF";
  title: string;
  subtitle: string | null;
};

export function PendingRequestsCard({ items }: { items: PendingItem[] }) {
  const empty = items.length === 0;
  return (
    <DashCard className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <Eyebrow>Pending requests</Eyebrow>
        <Link
          href="/requests"
          className="inline-flex items-center text-[11px] font-medium"
          style={{ color: DASH.violetBright }}
        >
          Open <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      {empty ? (
        <div
          className="flex flex-1 items-center gap-2 rounded-xl px-3 py-4 text-sm"
          style={{ background: "rgba(52,211,153,0.08)", color: DASH.emerald }}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> All clear — nothing waiting.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 4).map((r) => {
            const Icon = r.kind === "MISSED_PUNCH" ? FileClock : Plane;
            return (
              <li key={r.id}>
                <Link
                  href="/requests"
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${DASH.border}`,
                  }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "rgba(139,92,246,0.12)" }}
                  >
                    <Icon className="h-4 w-4" style={{ color: DASH.violetBright }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[13px] font-medium"
                      style={{ color: DASH.text }}
                    >
                      {r.title}
                    </span>
                    {r.subtitle ? (
                      <span
                        className="block truncate text-[11px]"
                        style={{ color: DASH.textFaint }}
                      >
                        {r.subtitle}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0"
                    style={{ color: DASH.textFaint }}
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
          {items.length > 4 ? (
            <li>
              <Link
                href="/requests"
                className="block rounded-xl px-3 py-2 text-center text-[12px] font-medium"
                style={{ color: DASH.violetBright, background: "rgba(139,92,246,0.08)" }}
              >
                View all {items.length}
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </DashCard>
  );
}

// ── Recent runs ──────────────────────────────────────────────────────────────

export type RecentRunItem = {
  id: string;
  href: string;
  label: string;
  scheduleName: string | null;
  amountCents: number | null;
  state: string;
};

const RUN_STATE_TONE: Record<string, { color: string; bg: string }> = {
  PUBLISHED: { color: DASH.emerald, bg: "rgba(52,211,153,0.12)" },
  APPROVED: { color: DASH.violetBright, bg: "rgba(139,92,246,0.14)" },
  AWAITING_ADMIN_REVIEW: { color: DASH.amber, bg: "rgba(251,191,36,0.12)" },
  AWAITING_EMPLOYEE_FIXES: { color: DASH.amber, bg: "rgba(251,191,36,0.12)" },
  FAILED: { color: DASH.rose, bg: "rgba(251,113,133,0.12)" },
  INGEST_FAILED: { color: DASH.rose, bg: "rgba(251,113,133,0.12)" },
};

function runTone(state: string): { color: string; bg: string } {
  return (
    RUN_STATE_TONE[state] ?? {
      color: DASH.textMuted,
      bg: "rgba(255,255,255,0.06)",
    }
  );
}

function prettyState(state: string): string {
  return state
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function RecentRunsCard({ items }: { items: RecentRunItem[] }) {
  const empty = items.length === 0;
  return (
    <DashCard className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <Eyebrow>Recent runs</Eyebrow>
        <Link
          href="/payroll"
          className="inline-flex items-center text-[11px] font-medium"
          style={{ color: DASH.violetBright }}
        >
          All runs <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      {empty ? (
        <div
          className="flex flex-1 items-center gap-2 rounded-xl px-3 py-4 text-sm"
          style={{ background: "rgba(255,255,255,0.04)", color: DASH.textMuted }}
        >
          <CalendarClock className="h-4 w-4" aria-hidden="true" /> No runs yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 4).map((r) => {
            const tone = runTone(r.state);
            return (
              <li key={r.id}>
                <Link
                  href={r.href}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${DASH.border}`,
                  }}
                >
                  <span className="min-w-0">
                    <span
                      className="block truncate text-[13px] font-medium tabular-nums"
                      style={{ color: DASH.text }}
                    >
                      {r.label}
                    </span>
                    <span
                      className="block truncate text-[11px]"
                      style={{ color: DASH.textFaint }}
                    >
                      {r.scheduleName ?? "—"}
                      {r.amountCents !== null
                        ? ` · ${formatMoney(r.amountCents)}`
                        : ""}
                    </span>
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ color: tone.color, background: tone.bg }}
                  >
                    {prettyState(r.state)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </DashCard>
  );
}

// ── Today (attendance buckets) ───────────────────────────────────────────────

export type TodayBuckets = {
  noPunch: { id: string; name: string }[];
  approvedOut: { id: string; name: string; type: string }[];
  punched: { id: string; name: string; firstPunchAt: string }[];
  label: string;
};

const TYPE_LABEL: Record<string, string> = {
  PERSONAL: "PTO",
  SICK: "Sick",
  UNPAID: "Unpaid",
  OTHER: "Other",
  SCHEDULE_NOTE: "Note",
};

function Bucket({
  icon: Icon,
  label,
  count,
  accent,
  children,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  count: number;
  accent: string;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: accent }}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          {label}
        </span>
        <span
          className="rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums"
          style={{ color: accent, background: `${accent}1f` }}
        >
          {count}
        </span>
      </div>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

export function TodayCard({ buckets }: { buckets: TodayBuckets }) {
  const total =
    buckets.noPunch.length +
    buckets.approvedOut.length +
    buckets.punched.length;
  const MAX = 4;
  return (
    <DashCard className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Today</Eyebrow>
        <span className="text-[11px]" style={{ color: DASH.textFaint }}>
          {buckets.label}
        </span>
      </div>

      {total === 0 ? (
        <p className="py-4 text-center text-[12px]" style={{ color: DASH.textFaint }}>
          No attendance data yet today.
        </p>
      ) : (
        <div className="space-y-4">
          <Bucket
            icon={UserX}
            label="Not punched in"
            count={buckets.noPunch.length}
            accent={DASH.rose}
          >
            {buckets.noPunch.slice(0, MAX).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-[12px]"
                style={{ color: DASH.text }}
              >
                <span className="truncate">{e.name}</span>
                <span style={{ color: DASH.rose }}>No punch</span>
              </li>
            ))}
            {buckets.noPunch.length > MAX ? (
              <li className="text-[10px]" style={{ color: DASH.textFaint }}>
                +{buckets.noPunch.length - MAX} more
              </li>
            ) : null}
          </Bucket>

          <Bucket
            icon={Plane}
            label="Approved out"
            count={buckets.approvedOut.length}
            accent={DASH.violetBright}
          >
            {buckets.approvedOut.slice(0, MAX).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-[12px]"
                style={{ color: DASH.text }}
              >
                <span className="truncate">{e.name}</span>
                <span style={{ color: DASH.violetBright }}>
                  {TYPE_LABEL[e.type] ?? e.type}
                </span>
              </li>
            ))}
          </Bucket>

          <Bucket
            icon={Clock4}
            label="Clocked in"
            count={buckets.punched.length}
            accent={DASH.emerald}
          >
            {buckets.punched.slice(0, MAX).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-[12px]"
                style={{ color: DASH.text }}
              >
                <span className="truncate">{e.name}</span>
                <span className="font-mono tabular-nums" style={{ color: DASH.emerald }}>
                  {e.firstPunchAt}
                </span>
              </li>
            ))}
            {buckets.punched.length > MAX ? (
              <li className="text-[10px]" style={{ color: DASH.textFaint }}>
                +{buckets.punched.length - MAX} more
              </li>
            ) : null}
          </Bucket>
        </div>
      )}
    </DashCard>
  );
}
