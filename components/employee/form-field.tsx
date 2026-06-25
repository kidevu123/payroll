// Phone-first form primitives for the employee PWA. The shared
// components/ui/input is 40px tall (h-10) — fine on desktop but below the
// 44px minimum comfortable tap target on a phone. These wrappers bump the
// touch surface, give textarea/select the same focus ring as Input, and
// render inline errors with a Lucide icon in the danger palette (no raw
// text-danger-700, no emoji).
//
// Pure presentational. No data logic. Safe to use in any employee form.

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Input, type InputProps } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// 44px tall controls — comfortable thumb targets on a phone. Applied on top
// of the shared Input so we don't touch the shared primitive.
const TOUCH_CONTROL =
  "h-11 text-base sm:text-sm";

const FIELD_BASE =
  "w-full rounded-input border border-border bg-surface px-3 transition-colors " +
  "hover:border-border-strong " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 " +
  "focus-visible:ring-offset-1 focus-visible:ring-offset-surface focus-visible:border-brand-700 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

/** Labelled input with a phone-sized tap target. */
export function Field({
  id,
  label,
  className,
  ...props
}: { label: React.ReactNode } & InputProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <Input id={id} className={cn(TOUCH_CONTROL, className)} {...props} />
    </div>
  );
}

/** Labelled native select matching the Field focus ring + tap target. */
export function SelectField({
  id,
  label,
  className,
  children,
  ...props
}: {
  label: React.ReactNode;
  children: React.ReactNode;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <select
        id={id}
        className={cn(FIELD_BASE, TOUCH_CONTROL, className)}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

/** Labelled textarea matching the Field focus ring; comfortable line-height. */
export function TextareaField({
  id,
  label,
  className,
  rows = 3,
  ...props
}: {
  label: React.ReactNode;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
      </Label>
      <textarea
        id={id}
        rows={rows}
        className={cn(
          FIELD_BASE,
          "py-2.5 text-base leading-relaxed sm:text-sm",
          className,
        )}
        {...props}
      />
    </div>
  );
}

/**
 * Radio row with a 44px tap target. Used for the "which punch is missing?"
 * choice in the missed-punch and report-fix forms. The whole row is the
 * label so the entire surface is tappable, not just the dot.
 */
export function SideRadio({
  name = "unpairedMissingSide",
  value,
  label,
  checked,
  onChange,
}: {
  name?: string;
  value: string;
  label: React.ReactNode;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-input border bg-surface px-3 py-2.5 text-sm transition-colors",
        checked
          ? "border-brand-300 bg-brand-50 text-brand-900"
          : "border-border text-text hover:bg-surface-2",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-brand-700"
      />
      <span>{label}</span>
    </label>
  );
}

/** Inline form error — danger palette, Lucide icon, never raw red. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-1.5 rounded-input border border-danger-200/80 bg-danger-50 px-3 py-2 text-sm font-medium text-danger-700"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}
