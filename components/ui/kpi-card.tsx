// The KPI tile used above the /payroll and /reports ledgers: tinted icon
// plate (hidden on phones), label, figure, one context line. Pass `href` to
// make the whole tile a link.
import type React from "react";
import Link from "next/link";

const PLATE = {
  brand: "bg-brand-50 text-brand-700",
  info: "bg-info-50 text-info-700",
  warning: "bg-warning-50 text-warning-700",
} as const;

export function KpiCard({
  label,
  tone,
  icon: Icon,
  value,
  context,
  href,
}: {
  label: string;
  tone: keyof typeof PLATE;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  context: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <span aria-hidden className={`mt-0.5 hidden h-12 w-12 shrink-0 items-center justify-center rounded-input sm:flex ${PLATE[tone]}`}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm text-text-muted">{label}</div>
        <div className="mt-0.5 truncate text-metric tabular-nums tracking-tight text-text max-sm:text-xl">{value}</div>
        <div className="mt-1 text-caption text-text-subtle">{context}</div>
      </div>
    </>
  );
  const cls = "flex items-start gap-4 rounded-card border border-border/70 bg-surface px-3.5 py-3 shadow-card sm:px-5 sm:py-4";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:bg-surface-2/40`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
