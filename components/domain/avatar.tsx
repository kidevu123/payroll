// Avatar — photo if uploaded, otherwise initials in a brand-tinted
// circle. Employees can upload a photo from /me/profile; the bytes
// land under /data/uploads/photos/<employee-id>.<ext> and the URL is
// served by /api/employees/[id]/photo.
//
// Color (initials variant) is picked deterministically from a small
// palette keyed on the name so a list of employees gets a pleasant
// variety without anyone choosing colors. All shades come from the
// @theme tokens so dark mode works with no extra branching.

import * as React from "react";
import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
} as const;

// Six-tone palette using semantic tokens — keeps everything theme-driven.
const TONE_CLASS = [
  "bg-brand-50 text-brand-800",
  "bg-info-50 text-info-700",
  "bg-warning-50 text-warning-700",
  "bg-success-50 text-success-700",
  "bg-danger-50 text-danger-700",
  "bg-surface-2 text-text",
] as const;

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function toneFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TONE_CLASS[h % TONE_CLASS.length]!;
}

export function Avatar({
  name,
  size = "md",
  photoUrl,
  className,
}: {
  name: string;
  size?: keyof typeof SIZE_CLASS;
  /** When provided, render the photo and fall back to initials only
   *  if the image fails to load. */
  photoUrl?: string | null;
  className?: string;
}) {
  if (photoUrl) {
    return (
      // Plain <img> avoids next/image's per-route static analysis cost
      // for a tiny user-uploaded photo. object-fit:cover keeps the
      // crop tasteful regardless of source aspect ratio.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={`${name} avatar`}
        className={cn(
          "rounded-full object-cover shrink-0 ring-1 ring-border/60",
          SIZE_CLASS[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center justify-center rounded-full font-semibold tracking-tight shrink-0",
        SIZE_CLASS[size],
        toneFor(name),
        className,
      )}
    >
      {initialsFor(name)}
    </span>
  );
}
