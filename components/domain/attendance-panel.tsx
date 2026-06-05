const TYPE_LABEL: Record<string, string> = {
  PERSONAL: "PTO",
  SICK: "Sick",
  UNPAID: "Unpaid",
  OTHER: "Other",
};

export type AttendancePanelProps = {
  punched: { id: string; name: string; firstPunchAt: string }[];
  approvedOut: { id: string; name: string; type: string }[];
  noPunch: { id: string; name: string }[];
  todayLabel: string;
};

const MAX_VISIBLE = 4;

function SectionHeader({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "red" | "purple" | "green";
}) {
  const dotCls =
    tone === "red"
      ? "bg-danger-500"
      : tone === "purple"
        ? "bg-violet-500"
        : "bg-success-500";
  const labelCls =
    tone === "red"
      ? "text-danger-700"
      : tone === "purple"
        ? "text-violet-700"
        : "text-success-700";
  const badgeCls =
    tone === "red"
      ? "bg-danger-100 text-danger-800"
      : tone === "purple"
        ? "bg-violet-100 text-violet-800"
        : "bg-success-100 text-success-800";

  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full shrink-0 ${dotCls}`} />
        <span
          className={`text-[9px] font-bold uppercase tracking-wider ${labelCls}`}
        >
          {label}
        </span>
      </div>
      <span
        className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${badgeCls}`}
      >
        {count}
      </span>
    </div>
  );
}

export function AttendancePanel({
  punched,
  approvedOut,
  noPunch,
  todayLabel,
}: AttendancePanelProps) {
  const hasAny = punched.length + approvedOut.length + noPunch.length > 0;

  return (
    <div className="rounded-card border border-border bg-surface p-4 space-y-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Today · {todayLabel}
      </div>

      {noPunch.length > 0 && (
        <section>
          <SectionHeader
            label="Expected · not punched in"
            count={noPunch.length}
            tone="red"
          />
          <ul className="rounded-card border border-danger-300 bg-danger-50 px-3 py-2 space-y-1.5">
            {noPunch.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-semibold text-danger-800 truncate">
                  {e.name}
                </span>
                <span className="text-danger-600 shrink-0 ml-2">No punch</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {approvedOut.length > 0 && (
        <section>
          <SectionHeader
            label="Out · approved"
            count={approvedOut.length}
            tone="purple"
          />
          <ul className="rounded-card border border-violet-300 bg-violet-50 px-3 py-2 space-y-1.5">
            {approvedOut.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-medium text-violet-900 truncate">
                  {e.name}
                </span>
                <span className="text-violet-600 shrink-0 ml-2">
                  {TYPE_LABEL[e.type] ?? e.type}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {punched.length > 0 && (
        <section>
          <SectionHeader
            label="Clocked in"
            count={punched.length}
            tone="green"
          />
          <ul className="rounded-card border border-success-300 bg-success-50 px-3 py-2 space-y-1.5">
            {punched.slice(0, MAX_VISIBLE).map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="font-medium text-success-900 truncate">
                  {e.name}
                </span>
                <span className="font-mono text-success-700 shrink-0 ml-2">
                  {e.firstPunchAt}
                </span>
              </li>
            ))}
            {punched.length > MAX_VISIBLE && (
              <li className="text-center text-[10px] text-success-600 pt-0.5 border-t border-success-200">
                + {punched.length - MAX_VISIBLE} more
              </li>
            )}
          </ul>
        </section>
      )}

      {!hasAny && (
        <p className="text-xs text-text-muted text-center py-4">
          No attendance data yet today.
        </p>
      )}
    </div>
  );
}
