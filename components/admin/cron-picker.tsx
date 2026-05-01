"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type CronPreset = {
  label: string;
  value: string;
  hint?: string;
};

const PRESETS: CronPreset[] = [
  { label: "Every 5 minutes", value: "*/5 * * * *", hint: "Realtime poll" },
  { label: "Every 15 minutes", value: "*/15 * * * *", hint: "Realtime poll" },
  { label: "Every 30 minutes", value: "*/30 * * * *", hint: "Realtime poll" },
  { label: "Every hour", value: "0 * * * *", hint: "Hourly poll" },
  { label: "Every Sunday at 7pm", value: "0 19 * * 0", hint: "Weekly close after Saturday's punches" },
  { label: "Every Saturday at 7pm", value: "0 19 * * 6", hint: "Weekly close on Saturday" },
  { label: "Every Friday at 5pm", value: "0 17 * * 5", hint: "End-of-week Friday cutoff" },
  { label: "Every weekday at 6pm", value: "0 18 * * 1-5", hint: "Mon–Fri end of day" },
  { label: "1st & 16th at 7pm", value: "0 19 1,16 * *", hint: "Semi-monthly cycle" },
  { label: "Last day of month at 7pm", value: "0 19 28-31 * *", hint: "Monthly close" },
];

/**
 * Cron picker. Renders a friendly preset dropdown + a hidden text input
 * named `name` that the form submits. "Custom (advanced)" reveals the
 * raw cron field for unusual schedules. Live-validates the cron pattern
 * against a permissive 5-field regex.
 */
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
  const initialMatchedPreset =
    PRESETS.find((p) => p.value === defaultValue) ?? null;
  const [selected, setSelected] = React.useState<string>(
    initialMatchedPreset ? initialMatchedPreset.value : "__custom__",
  );
  const [custom, setCustom] = React.useState<string>(defaultValue);

  const value = selected === "__custom__" ? custom : selected;
  // Permissive cron regex: digits, *, /, ,, -, plus whitespace. The 5-field
  // length check below makes the malformed-banner light up.
  const validCron =
    /^[\d*/,\- ]+$/.test(value) && value.trim().split(/\s+/).length === 5;

  const description = React.useMemo(() => describeCron(value), [value]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select
        value={selected}
        onChange={(e) => {
          const v = e.target.value;
          setSelected(v);
          if (v !== "__custom__") setCustom(v);
        }}
        className="h-10 w-full rounded-input border border-border bg-surface px-3 text-sm"
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label} ({p.value})
          </option>
        ))}
        <option value="__custom__">Custom (advanced)</option>
      </select>
      {selected === "__custom__" ? (
        <div className="space-y-1">
          <Input
            name={name}
            required={required}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="0 19 * * 0"
            className="font-mono"
          />
          <p className="text-xs text-text-muted">
            Five fields: minute hour day-of-month month day-of-week. Use{" "}
            <a
              href="https://crontab.guru/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 underline"
            >
              crontab.guru
            </a>{" "}
            to translate.
          </p>
        </div>
      ) : (
        // Render a hidden input so the form still submits the resolved value.
        <input type="hidden" name={name} value={value} />
      )}
      <div
        className={`rounded-input border px-3 py-2 text-xs ${
          validCron
            ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : "border-amber-300 bg-amber-50 text-amber-800"
        }`}
      >
        <span className="font-mono mr-2">{value || "—"}</span>
        <span>{validCron ? description : "Cron string looks malformed."}</span>
      </div>
    </div>
  );
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Best-effort cron-to-English. Handles the common patterns we ship. */
function describeCron(c: string): string {
  const parts = c.trim().split(/\s+/);
  if (parts.length !== 5) return "Invalid cron length.";
  const [minRaw, hourRaw, domRaw, monRaw, dowRaw] = parts as [string, string, string, string, string];

  // Stride patterns: "*/N * * * *" → every N minutes / hours.
  const stride = /^\*\/(\d+)$/.exec(minRaw);
  if (stride && hourRaw === "*" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return `Every ${stride[1]} minute${stride[1] === "1" ? "" : "s"}.`;
  }
  if (minRaw === "0" && /^\*\/(\d+)$/.exec(hourRaw) && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    const h = /^\*\/(\d+)$/.exec(hourRaw)![1]!;
    return `Every ${h} hour${h === "1" ? "" : "s"}.`;
  }
  if (minRaw === "0" && hourRaw === "*" && domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return "Every hour, on the hour.";
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

  // Day-of-week handling
  if (domRaw === "*" && monRaw === "*" && dowRaw !== "*") {
    if (/^\d+$/.test(dowRaw)) {
      return `Every ${DOW_NAMES[Number(dowRaw)] ?? dowRaw}day at ${time}.`;
    }
    if (/^\d+(,\d+)+$/.test(dowRaw)) {
      const days = dowRaw.split(",").map((d) => DOW_NAMES[Number(d)] ?? d).join(", ");
      return `${days} at ${time}.`;
    }
    if (/^\d+-\d+$/.test(dowRaw)) {
      const [a, b] = dowRaw.split("-").map(Number);
      return `${DOW_NAMES[a!]} through ${DOW_NAMES[b!]} at ${time}.`;
    }
  }

  // Day-of-month handling
  if (dowRaw === "*" && monRaw === "*" && domRaw !== "*") {
    if (/^\d+$/.test(domRaw)) return `On the ${ordinal(Number(domRaw))} of every month at ${time}.`;
    if (/^\d+(,\d+)+$/.test(domRaw)) {
      const days = domRaw.split(",").map((d) => ordinal(Number(d))).join(" and ");
      return `On the ${days} of every month at ${time}.`;
    }
    if (/^\d+-\d+$/.test(domRaw)) {
      const [a, b] = domRaw.split("-").map(Number);
      return `On the ${ordinal(a!)} through ${ordinal(b!)} of every month at ${time}.`;
    }
  }

  // Month + DoM
  if (dowRaw === "*" && /^\d+$/.test(monRaw) && /^\d+$/.test(domRaw)) {
    return `Every ${MONTH_NAMES[Number(monRaw) - 1] ?? monRaw} ${ordinal(Number(domRaw))} at ${time}.`;
  }

  if (domRaw === "*" && monRaw === "*" && dowRaw === "*") {
    return `Every day at ${time}.`;
  }

  return `Fires per cron pattern at ${time}.`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
