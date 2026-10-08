// Rail card: counts of the punch problems that need an admin.
export function ExceptionsQueueCard({
  missing,
  unpaired,
  openShifts,
}: {
  missing: number;
  unpaired: number;
  openShifts: number;
}) {
  const total = missing + unpaired + openShifts;
  const rows = [
    { label: "Missing punches", value: missing, color: "var(--dash-rose)" },
    { label: "Unpaired punches", value: unpaired, color: "var(--dash-amber)" },
    { label: "Open shifts", value: openShifts, color: "var(--dash-cyan)" },
  ];
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          Exceptions queue
          {total > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-50 px-1.5 text-[11px] font-bold text-warning-700">
              {total}
            </span>
          )}
        </h3>
      </div>
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-text-muted">
              <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="font-semibold tabular-nums">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
