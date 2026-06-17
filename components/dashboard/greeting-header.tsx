// Dashboard greeting header: time-of-day greeting + name, subtitle, today
// date pill, and a primary quick-action button. Time-of-day is derived from
// the company timezone server-side so it matches the operator's clock.

import Link from "next/link";
import { CalendarDays, Sun, Sunrise, Sunset, PlayCircle } from "lucide-react";
import { DASH } from "./theme";

type Props = {
  name: string;
  /** Hour 0–23 in the company timezone, for the greeting word + icon. */
  hour: number;
  todayLabel: string;
  /** Where the primary quick action points (e.g. the most urgent run). */
  quickActionHref: string;
  quickActionLabel: string;
};

function greetingFor(hour: number): { word: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> } {
  if (hour < 12) return { word: "Good morning", Icon: Sunrise };
  if (hour < 17) return { word: "Good afternoon", Icon: Sun };
  return { word: "Good evening", Icon: Sunset };
}

export function GreetingHeader({
  name,
  hour,
  todayLabel,
  quickActionHref,
  quickActionLabel,
}: Props) {
  const { word, Icon } = greetingFor(hour);
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5" style={{ color: DASH.violetBright }} aria-hidden="true" />
          <h1
            className="text-[2rem] font-bold leading-tight tracking-[-0.02em] sm:text-[2.5rem]"
            style={{ color: DASH.text }}
          >
            {word}, {name}
          </h1>
        </div>
        <p className="mt-1 text-sm" style={{ color: DASH.textMuted }}>
          Here&rsquo;s what&rsquo;s happening with your payroll today.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span
          className="inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium"
          style={{
            color: DASH.textMuted,
            background: DASH.surface,
            border: `1px solid ${DASH.border}`,
          }}
        >
          <CalendarDays className="h-4 w-4" style={{ color: DASH.violetBright }} aria-hidden="true" />
          <span className="tabular-nums">{todayLabel}</span>
        </span>
        <Link
          href={quickActionHref}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold"
          style={{ color: "#0b0b12", background: DASH.violetBright }}
        >
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
          {quickActionLabel}
        </Link>
      </div>
    </header>
  );
}
