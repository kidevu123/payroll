import { MoneyDisplay } from "./money-display";
import { HoursDisplay } from "./hours-display";

export type StatStripProps = {
  inToday: number;
  totalActive: number;
  periodHours: number;
  weeklyGrossCents: number | null;
  semiMonthlyGrossCents: number | null;
  exceptions: number;
  /** Timestamp of the last successful NGTeco poll. Null if never polled. */
  lastPollAt: Date | null;
};

type SyncStatus = { label: string; sub: string; tone: "green" | "amber" | "red" };

function syncStatus(lastPollAt: Date | null): SyncStatus {
  if (!lastPollAt) return { label: "No poll", sub: "Never run", tone: "red" };
  const mins = Math.floor((Date.now() - lastPollAt.getTime()) / 60_000);
  if (mins < 30) return { label: "Live", sub: `${mins}m ago`, tone: "green" };
  if (mins < 60) return { label: `${mins}m ago`, sub: "Check NGTeco", tone: "amber" };
  return { label: "Stale", sub: `${Math.floor(mins / 60)}h ago`, tone: "red" };
}

const TONE_CLASSES: Record<"green" | "amber" | "red" | "neutral", string> = {
  green: "bg-success-50 border-success-200",
  amber: "bg-warn-50 border-warn-200",
  red: "bg-danger-50 border-danger-200",
  neutral: "bg-surface border-border",
};
const TONE_LABEL: Record<"green" | "amber" | "red" | "neutral", string> = {
  green: "text-success-800",
  amber: "text-warn-800",
  red: "text-danger-800",
  neutral: "text-text",
};
const TONE_SUB: Record<"green" | "amber" | "red" | "neutral", string> = {
  green: "text-success-600",
  amber: "text-warn-600",
  red: "text-danger-600",
  neutral: "text-text-muted",
};

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone?: "green" | "amber" | "red" | "neutral";
}) {
  return (
    <div className={`rounded-card border px-3 py-3 ${TONE_CLASSES[tone]}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-text-subtle mb-1">
        {label}
      </div>
      <div
        className={`font-mono text-xl font-semibold tabular-nums leading-tight ${TONE_LABEL[tone]}`}
      >
        {value}
      </div>
      <div className={`text-[10px] mt-0.5 ${TONE_SUB[tone]}`}>{sub}</div>
    </div>
  );
}

export function StatStrip({
  inToday,
  totalActive,
  periodHours,
  weeklyGrossCents,
  semiMonthlyGrossCents,
  exceptions,
  lastPollAt,
}: StatStripProps) {
  const sync = syncStatus(lastPollAt);
  const absent = totalActive - inToday;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile
        label="In today"
        value={
          <>
            {inToday}
            <span className="text-sm font-normal text-text-muted">
              {" "}
              / {totalActive}
            </span>
          </>
        }
        sub={absent === 0 ? "everyone in" : `${absent} not yet in`}
      />
      <StatTile
        label="Hours this period"
        value={<HoursDisplay hours={periodHours} decimals={1} />}
        sub="accrued so far"
      />
      {weeklyGrossCents !== null && (
        <StatTile
          label="Weekly gross"
          value={<MoneyDisplay cents={weeklyGrossCents} monospace />}
          sub="est."
        />
      )}
      {semiMonthlyGrossCents !== null && (
        <StatTile
          label="Semi-mo. gross"
          value={<MoneyDisplay cents={semiMonthlyGrossCents} monospace />}
          sub="est."
        />
      )}
      <StatTile
        label="Exceptions"
        value={String(exceptions)}
        sub={exceptions === 0 ? "all clear" : "unresolved"}
        tone={exceptions > 0 ? "amber" : "green"}
      />
      <StatTile
        label="NGTeco sync"
        value={sync.label}
        sub={sync.sub}
        tone={sync.tone}
      />
    </div>
  );
}
