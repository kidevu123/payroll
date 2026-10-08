// Rail card: today's attendance as a donut plus a legend.
const SUMMARY_SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: "present", label: "Present", color: "var(--dash-emerald)" },
  { key: "incomplete", label: "Incomplete", color: "var(--dash-amber)" },
  { key: "missing", label: "Missing", color: "var(--dash-rose)" },
  { key: "timeOff", label: "Time off", color: "var(--dash-blue)" },
  { key: "unpaid", label: "Unpaid", color: "var(--dash-text-faint)" },
];

export function TodaySummaryCard({
  summary,
  total,
}: {
  summary: Record<string, number>;
  total: number;
}) {
  let acc = 0;
  const stops: string[] = [];
  for (const s of SUMMARY_SEGMENTS) {
    const v = summary[s.key] ?? 0;
    if (total > 0 && v > 0) {
      const start = (acc / total) * 360;
      acc += v;
      const end = (acc / total) * 360;
      stops.push(`${s.color} ${start}deg ${end}deg`);
    }
  }
  const ring =
    total > 0
      ? `conic-gradient(${stops.join(", ")})`
      : "conic-gradient(var(--dash-border) 0deg 360deg)";
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Today&rsquo;s summary</h3>
        <span className="text-micro uppercase text-text-subtle">
          Updated just now
        </span>
      </div>
      <div className="mt-3 flex items-center gap-4">
        <div
          className="relative h-[88px] w-[88px] shrink-0 rounded-full"
          style={{ background: ring }}
        >
          <div className="absolute inset-[11px] flex flex-col items-center justify-center rounded-full bg-surface">
            <span className="text-lg font-bold leading-none tabular-nums">{total}</span>
            <span className="text-[10px] text-text-muted">Total</span>
          </div>
        </div>
        <ul className="flex-1 space-y-1">
          {SUMMARY_SEGMENTS.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums">{summary[s.key] ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
