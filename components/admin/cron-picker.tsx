"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/* Friendly cron picker.
 *
 * The point: an operator who's never written cron in their life should
 * be able to set "Every Sunday at 7pm" without seeing the string
 * "0 19 * * 0" anywhere except as a confirmation. There are three modes:
 *
 *   1. "Every N minutes / hours"  — a small preset list for the
 *      real-time poll case (every 5/15/30 min, every hour).
 *   2. "On specific days at a specific time" — day-of-week checkboxes
 *      + a real <input type="time"> picker. Composes the cron string
 *      under the hood.
 *   3. "Once a month on these dates at this time" — day-of-month
 *      multi-select + time picker. Covers the 1st-and-16th case.
 *   4. "Custom (advanced)" — raw text input for anything else.
 *
 * The hidden form field always carries the resolved cron string, so
 * downstream code (pg-boss) is unchanged. */

type Mode = "interval" | "weekly" | "monthly" | "custom";

type IntervalPreset = { label: string; value: string };

const INTERVAL_PRESETS: ReadonlyArray<IntervalPreset> = [
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every hour, on the hour", value: "0 * * * *" },
];

const DOW = [
  { value: 0, short: "Sun", long: "Sunday" },
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
] as const;

export function CronPicker({
  name,
  defaultValue,
  label = "Schedule",
  required = true,
}: {
  name: string;
  defaultValue: string;
  label?: string;
  required?: boolean;
}) {
  const initial = parseCron(defaultValue);
  const [mode, setMode] = React.useState<Mode>(initial.mode);

  // Mode-specific state. We hydrate every state from `initial` so a
  // mode switch back-and-forth doesn't lose what was there.
  const [intervalValue, setIntervalValue] = React.useState<string>(
    initial.mode === "interval" ? defaultValue : "*/15 * * * *",
  );
  const [weeklyDays, setWeeklyDays] = React.useState<Set<number>>(
    initial.mode === "weekly" ? new Set(initial.weeklyDays) : new Set([0]),
  );
  const [weeklyTime, setWeeklyTime] = React.useState<string>(
    initial.mode === "weekly" ? initial.timeHHMM : "19:00",
  );
  const [monthlyDays, setMonthlyDays] = React.useState<string>(
    initial.mode === "monthly" ? initial.monthlyDays.join(",") : "1,16",
  );
  const [monthlyTime, setMonthlyTime] = React.useState<string>(
    initial.mode === "monthly" ? initial.timeHHMM : "19:00",
  );
  const [custom, setCustom] = React.useState<string>(defaultValue);

  const value = React.useMemo(() => {
    if (mode === "interval") return intervalValue;
    if (mode === "weekly") return composeWeekly(weeklyTime, weeklyDays);
    if (mode === "monthly") return composeMonthly(monthlyTime, monthlyDays);
    return custom;
  }, [mode, intervalValue, weeklyTime, weeklyDays, monthlyTime, monthlyDays, custom]);

  const description = React.useMemo(() => describeCron(value), [value]);
  const valid = isValidCron(value);

  return (
    <div className="space-y-3">
      <Label>{label}</Label>

      <div className="rounded-card border border-border bg-surface p-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <ModeChip
            active={mode === "interval"}
            onClick={() => setMode("interval")}
            label="Every few minutes / hours"
          />
          <ModeChip
            active={mode === "weekly"}
            onClick={() => setMode("weekly")}
            label="Pick days of the week"
          />
          <ModeChip
            active={mode === "monthly"}
            onClick={() => setMode("monthly")}
            label="Pick days of the month"
          />
          <ModeChip
            active={mode === "custom"}
            onClick={() => setMode("custom")}
            label="Custom (advanced)"
          />
        </div>

        {mode === "interval" && (
          <select
            value={intervalValue}
            onChange={(e) => setIntervalValue(e.target.value)}
            className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
          >
            {INTERVAL_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        )}

        {mode === "weekly" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-text-muted">Which days?</Label>
              <div className="mt-1 flex flex-wrap gap-1">
                {DOW.map((d) => {
                  const active = weeklyDays.has(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        setWeeklyDays((prev) => {
                          const next = new Set(prev);
                          if (next.has(d.value)) next.delete(d.value);
                          else next.add(d.value);
                          // Don't allow empty selection — fall back to Sun.
                          if (next.size === 0) next.add(0);
                          return next;
                        });
                      }}
                      className={`h-9 min-w-12 px-3 rounded-input border text-xs font-medium transition-colors ${
                        active
                          ? "border-brand-700 bg-brand-50 text-brand-700"
                          : "border-border bg-surface text-text-muted hover:bg-surface-2"
                      }`}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor={`${name}-time`} className="text-xs text-text-muted shrink-0">
                What time?
              </Label>
              <Input
                id={`${name}-time`}
                type="time"
                value={weeklyTime}
                onChange={(e) => setWeeklyTime(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        )}

        {mode === "monthly" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-text-muted">Which days of the month?</Label>
              <div className="mt-1">
                <Input
                  value={monthlyDays}
                  onChange={(e) => setMonthlyDays(e.target.value)}
                  placeholder="e.g. 1, 16"
                />
                <p className="mt-1 text-[11px] text-text-muted">
                  Comma-separated. Use single days (1, 15) or
                  &ldquo;last&rdquo; via Custom mode.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Label
                htmlFor={`${name}-month-time`}
                className="text-xs text-text-muted shrink-0"
              >
                What time?
              </Label>
              <Input
                id={`${name}-month-time`}
                type="time"
                value={monthlyTime}
                onChange={(e) => setMonthlyTime(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        )}

        {mode === "custom" && (
          <div className="space-y-1">
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="0 19 * * 0"
              className="font-mono"
            />
            <p className="text-xs text-text-muted">
              Five fields: minute hour day-of-month month day-of-week.
              Use{" "}
              <a
                href="https://crontab.guru/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-700 underline"
              >
                crontab.guru
              </a>{" "}
              if you need help — most users want one of the friendlier
              modes above.
            </p>
          </div>
        )}
      </div>

      {/* The form's actual submitted value. Always the resolved cron. */}
      <input type="hidden" name={name} value={value} required={required} />

      <div
        className={`rounded-input border px-3 py-2 text-xs ${
          valid
            ? "border-success-200 bg-success-50 text-success-800"
            : "border-warning-200 bg-warning-50 text-warning-800"
        }`}
      >
        <span className="block font-medium">
          {valid ? `${description} (in your local time)` : "Schedule looks malformed — fix before saving."}
        </span>
        <span className="font-mono text-[11px] text-text-muted">
          (cron: {value || "—"})
        </span>
      </div>
    </div>
  );
}

function ModeChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 px-3 rounded-chip border text-xs font-medium transition-colors ${
        active
          ? "border-brand-700 bg-brand-700 text-brand-fg"
          : "border-border bg-surface text-text-muted hover:bg-surface-2"
      }`}
    >
      {label}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

type ParsedCron =
  | { mode: "interval" }
  | { mode: "weekly"; weeklyDays: number[]; timeHHMM: string }
  | { mode: "monthly"; monthlyDays: number[]; timeHHMM: string }
  | { mode: "custom" };

function parseCron(c: string): ParsedCron {
  const parts = c.trim().split(/\s+/);
  if (parts.length !== 5) return { mode: "custom" };
  const [min, hour, dom, mon, dow] = parts as [string, string, string, string, string];

  // Interval: */N * * * * or 0 * * * * (every hour) or 0 */N * * *
  if (
    /^\*\/\d+$/.test(min) &&
    hour === "*" &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  )
    return { mode: "interval" };
  if (
    min === "0" &&
    (hour === "*" || /^\*\/\d+$/.test(hour)) &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  )
    return { mode: "interval" };

  // Weekly: minute hour * * dow (single day, list, or range)
  if (
    /^\d+$/.test(min) &&
    /^\d+$/.test(hour) &&
    dom === "*" &&
    mon === "*" &&
    dow !== "*"
  ) {
    const days = expandList(dow);
    if (days && days.every((d) => d >= 0 && d <= 6)) {
      return {
        mode: "weekly",
        weeklyDays: days,
        timeHHMM: `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`,
      };
    }
  }

  // Monthly: minute hour dom * *
  if (
    /^\d+$/.test(min) &&
    /^\d+$/.test(hour) &&
    dom !== "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    const days = expandList(dom);
    if (days && days.every((d) => d >= 1 && d <= 31)) {
      return {
        mode: "monthly",
        monthlyDays: days,
        timeHHMM: `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`,
      };
    }
  }

  return { mode: "custom" };
}

function expandList(s: string): number[] | null {
  // Accepts "5" / "1,15" / "1-3" — for the simple cases. Returns null
  // on anything else so we fall through to custom mode.
  if (/^\d+$/.test(s)) return [Number(s)];
  if (/^\d+(,\d+)+$/.test(s)) return s.split(",").map(Number);
  if (/^\d+-\d+$/.test(s)) {
    const [a, b] = s.split("-").map(Number);
    if (a == null || b == null || a > b) return null;
    const out: number[] = [];
    for (let i = a; i <= b; i++) out.push(i);
    return out;
  }
  return null;
}

function composeWeekly(timeHHMM: string, days: Set<number>): string {
  const [h, m] = parseTime(timeHHMM);
  const sorted = Array.from(days).sort((a, b) => a - b);
  return `${m} ${h} * * ${sorted.join(",")}`;
}

function composeMonthly(timeHHMM: string, daysCsv: string): string {
  const [h, m] = parseTime(timeHHMM);
  const cleaned = daysCsv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 31)
    .join(",");
  return `${m} ${h} ${cleaned || "1"} * *`;
}

function parseTime(t: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return [0, 0];
  return [Number(m[1]), Number(m[2])];
}

function isValidCron(c: string): boolean {
  return (
    /^[\d*/,\- ]+$/.test(c.trim()) && c.trim().split(/\s+/).length === 5
  );
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function describeCron(c: string): string {
  const parts = c.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid cron length.";
  const [minRaw, hourRaw, domRaw, monRaw, dowRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const stride = /^\*\/(\d+)$/.exec(minRaw);
  if (stride && hourRaw === "*" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return `Runs every ${stride[1]} minute${stride[1] === "1" ? "" : "s"}.`;
  }
  if (
    minRaw === "0" &&
    /^\*\/(\d+)$/.exec(hourRaw) &&
    domRaw === "*" &&
    monRaw === "*" &&
    dowRaw === "*"
  ) {
    const h = /^\*\/(\d+)$/.exec(hourRaw)![1]!;
    return `Runs every ${h} hour${h === "1" ? "" : "s"}.`;
  }
  if (
    minRaw === "0" &&
    hourRaw === "*" &&
    domRaw === "*" &&
    monRaw === "*" &&
    dowRaw === "*"
  ) {
    return "Runs every hour, on the hour.";
  }

  const time = (() => {
    const min = Number(minRaw);
    const hour = Number(hourRaw);
    if (!Number.isFinite(min) || !Number.isFinite(hour)) return null;
    const ampm = hour >= 12 ? "pm" : "am";
    const hr12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hr12}:${String(min).padStart(2, "0")} ${ampm}`;
  })();

  if (!time) return `Fires when minute matches ${minRaw} and hour matches ${hourRaw}.`;

  if (domRaw === "*" && monRaw === "*" && dowRaw !== "*") {
    if (/^\d+$/.test(dowRaw)) {
      return `Runs every ${DOW_NAMES[Number(dowRaw)] ?? dowRaw}day at ${time}.`;
    }
    if (/^\d+(,\d+)+$/.test(dowRaw)) {
      const days = dowRaw
        .split(",")
        .map((d) => DOW_NAMES[Number(d)] ?? d)
        .join(", ");
      return `Runs ${days} at ${time}.`;
    }
    if (/^\d+-\d+$/.test(dowRaw)) {
      const [a, b] = dowRaw.split("-").map(Number);
      return `Runs ${DOW_NAMES[a!]} through ${DOW_NAMES[b!]} at ${time}.`;
    }
  }

  if (dowRaw === "*" && monRaw === "*" && domRaw !== "*") {
    if (/^\d+$/.test(domRaw)) return `Runs on the ${ordinal(Number(domRaw))} of every month at ${time}.`;
    if (/^\d+(,\d+)+$/.test(domRaw)) {
      const days = domRaw
        .split(",")
        .map((d) => ordinal(Number(d)))
        .join(" and ");
      return `Runs on the ${days} of every month at ${time}.`;
    }
    if (/^\d+-\d+$/.test(domRaw)) {
      const [a, b] = domRaw.split("-").map(Number);
      return `Runs on the ${ordinal(a!)} through ${ordinal(b!)} of every month at ${time}.`;
    }
  }

  if (dowRaw === "*" && /^\d+$/.test(monRaw) && /^\d+$/.test(domRaw)) {
    return `Runs every ${MONTH_NAMES[Number(monRaw) - 1] ?? monRaw} ${ordinal(Number(domRaw))} at ${time}.`;
  }

  if (domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return `Runs every day at ${time}.`;
  }

  return `Runs per cron pattern at ${time}.`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
