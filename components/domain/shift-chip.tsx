// Replaces emoji glyphs everywhere. The chip's visual identity is its color
// swatch + name; everything else (icon font, glyph) is intentionally absent.

import * as React from "react";
import { cn } from "@/lib/utils";

export function ShiftChip({
  name,
  colorHex,
  archived,
  className,
}: {
  name: string;
  colorHex?: string | null;
  archived?: boolean;
  className?: string;
}) {
  const color = colorHex ?? "#0f766e";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-chip border border-border bg-surface-2 px-2 py-0.5 text-xs font-medium text-text",
        archived && "line-through opacity-60",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}
