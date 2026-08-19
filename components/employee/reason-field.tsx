"use client";

// Reason entry tuned for phones. Typing a free-text reason on a phone
// keyboard is the slowest part of the fix-request forms, so the common
// causes are tappable chips that fill the field in one touch. The
// textarea stays for detail or anything the chips don't cover, and
// stays the single source of truth for what is submitted.

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const TEXTAREA_CLASSES =
  "w-full rounded-input border border-border bg-surface px-3 py-2.5 " +
  "text-base leading-relaxed sm:text-sm transition-colors " +
  "hover:border-border-strong " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 " +
  "focus-visible:ring-offset-1 focus-visible:ring-offset-surface focus-visible:border-brand-700";

export function ReasonField({
  id,
  name = "reason",
  label,
  quickReasons,
  placeholder,
}: {
  id: string;
  name?: string;
  label: React.ReactNode;
  quickReasons: string[];
  placeholder?: string;
}) {
  const [value, setValue] = React.useState("");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <div className="flex flex-wrap gap-2">
        {quickReasons.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() => setValue(reason)}
            className={cn(
              "min-h-11 rounded-chip border px-3 py-2 text-sm transition-colors",
              value === reason
                ? "border-brand-300 bg-brand-50 font-medium text-brand-900"
                : "border-border bg-surface text-text hover:bg-surface-2/40",
            )}
          >
            {reason}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        name={name}
        required
        minLength={1}
        maxLength={500}
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        {...(placeholder ? { placeholder } : {})}
        className={TEXTAREA_CLASSES}
      />
    </div>
  );
}
