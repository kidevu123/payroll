// Dashboard greeting header: time-of-day greeting + name, subtitle, and the
// right-side control cluster (date pill, Customize, Quick action) plus the
// "All amounts in USD · Compared to …" line. Time-of-day derives from the
// company timezone server-side. No emoji (repo rule) — a Lucide icon stands
// in for the reference's waving hand.

import Link from "next/link";
import {
  CalendarDays,
  ChevronDown,
  Plus,
  Settings2,
  Sun,
  Sunrise,
  Sunset,
} from "lucide-react";
import { DASH } from "./theme";

type Props = {
  name: string;
  /** Hour 0–23 in the company timezone, for the greeting word + icon. */
  hour: number;
  /** Long date, e.g. "June 16, 2026". */
  todayLabel: string;
  /** "Compared to Jun 9 – Jun 15, 2026" or null. */
  compareLabel: string | null;
  quickActionHref: string;
  quickActionLabel: string;
};

function greetingFor(hour: number): {
  word: string;
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
} {
  if (hour < 12) return { word: "Good morning", Icon: Sunrise };
  if (hour < 17) return { word: "Good afternoon", Icon: Sun };
  return { word: "Good evening", Icon: Sunset };
}

export function GreetingHeader({
  name,
  hour,
  todayLabel,
  compareLabel,
  quickActionHref,
  quickActionLabel,
}: Props) {
  const { word, Icon } = greetingFor(hour);
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <h1
          className="flex items-center gap-2.5 text-[1.3rem] font-bold leading-tight tracking-[-0.02em] sm:text-[1.5rem]"
          style={{ color: DASH.text }}
        >
          {word}, {name}
          <Icon className="h-6 w-6" style={{ color: DASH.amber }} aria-hidden="true" />
        </h1>
        <p className="mt-0.5 text-[12px]" style={{ color: DASH.textMuted }}>
          Here&rsquo;s what&rsquo;s happening with your payroll today.
        </p>
      </div>

      <div className="flex flex-col items-start gap-2 lg:items-end">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium"
            style={{
              color: DASH.text,
              background: DASH.surface,
              border: `1px solid ${DASH.border}`,
            }}
          >
            <CalendarDays className="h-4 w-4" style={{ color: DASH.textMuted }} aria-hidden="true" />
            <span className="tabular-nums">{todayLabel}</span>
            <ChevronDown className="h-3.5 w-3.5" style={{ color: DASH.textFaint }} aria-hidden="true" />
          </span>
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-medium"
            style={{
              color: DASH.text,
              background: DASH.surface,
              border: `1px solid ${DASH.border}`,
            }}
          >
            <Settings2 className="h-4 w-4" style={{ color: DASH.textMuted }} aria-hidden="true" />
            Customize
          </Link>
          <Link
            href={quickActionHref}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13px] font-semibold"
            style={{
              color: "#0b0b12",
              background: "linear-gradient(135deg, #34d399, #059669)",
              boxShadow: "0 8px 20px -8px rgba(5,150,105,0.7)",
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {quickActionLabel}
          </Link>
        </div>
        {compareLabel ? (
          <p className="text-[11px]" style={{ color: DASH.textFaint }}>
            All amounts in USD · {compareLabel}
          </p>
        ) : null}
      </div>
    </header>
  );
}
