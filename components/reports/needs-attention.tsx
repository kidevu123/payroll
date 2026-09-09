// "Needs attention" card: the handful of things on this page that want a
// click. Every line is a real count; a zero renders as a calm all-clear
// line rather than disappearing (the mock keeps the row).

import Link from "next/link";
import { AlertTriangle, ChevronRight, Clock, Lock, PenLine } from "lucide-react";

export type AttentionItem = {
  key: string;
  count: number;
  title: string;
  detail: string;
  href: string;
  icon: "lock" | "warn" | "clock" | "sign";
};

const ICON = { lock: Lock, warn: AlertTriangle, clock: Clock, sign: PenLine } as const;

export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  const open = items.reduce((n, i) => n + (i.count > 0 ? 1 : 0), 0);
  return (
    <div className="flex h-full flex-col rounded-card border border-border/70 bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-subheading font-semibold text-text">Needs attention</h2>
        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${open > 0 ? "bg-danger-600 text-white" : "bg-surface-2 text-text-subtle"}`}>
          {open}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          const Icon = ICON[item.icon];
          const active = item.count > 0;
          const tone = !active
            ? "bg-surface-2 text-text-subtle"
            : item.icon === "lock" || item.icon === "warn"
              ? "bg-danger-50 text-danger-700"
              : "bg-warning-50 text-warning-700";
          return (
            <li key={item.key}>
              <Link href={item.href} className="flex items-center gap-3 rounded-input border border-border/60 px-3 py-2.5 transition-colors hover:bg-surface-2/40">
                <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-input ${tone}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text">{item.title}</span>
                  <span className="block truncate text-xs text-text-subtle">{item.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
