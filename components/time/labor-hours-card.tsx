// Rail card: regular vs overtime hours for the period, with a per-day sparkline.
import { fmtHm } from "@/lib/time-grid/kpis";

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 132;
  const h = 30;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`)
    .join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LaborHoursCard({
  regularMin,
  overtimeMin,
  totalMin,
  spark,
}: {
  regularMin: number;
  overtimeMin: number;
  totalMin: number;
  spark: number[];
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Labor hours</h3>
        <span className="text-micro uppercase text-text-subtle">
          This pay period
        </span>
      </div>
      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-text-muted">Regular</dt>
          <dd className="font-semibold tabular-nums">{fmtHm(regularMin)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-muted">Overtime</dt>
          <dd className="font-semibold tabular-nums" style={{ color: "var(--dash-amber)" }}>
            {fmtHm(overtimeMin)}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-1.5">
          <dt className="font-medium">Total</dt>
          <dd className="font-bold tabular-nums">{fmtHm(totalMin)}</dd>
        </div>
      </dl>
      <div className="mt-2">
        <Sparkline data={spark} color="var(--dash-cyan)" />
      </div>
    </div>
  );
}
