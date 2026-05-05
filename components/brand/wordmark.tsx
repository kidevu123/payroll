// Wordmark: company logo (or initials in a brand-tinted square) + name.
// Used in the auth panel, sidebar header, and PWA splash. Pure presentation —
// callers pass the company record (name, logoPath optional). No fetching here
// so it can render in both server and client trees without async friction.
//
// The uploaded logo is treated as the GLYPH only — "Milo" (or the company
// name) renders as a text wordmark next to it. Owner directive: the app
// is branded "Milo" and the sidebar must say so even when the uploaded
// logo is just an icon. Pass showName={false} when the upload itself
// already contains the wordmark text.

import { cn } from "@/lib/utils";

export type WordmarkProps = {
  name: string;
  logoPath?: string | null;
  size?: "sm" | "md" | "lg" | "xl" | "2xl";
  showName?: boolean;
  className?: string;
};

// `logoMaxW` caps how wide the rendered logo can grow. Without a cap, a
// wide wordmark (e.g. "Acme Industries") at the sidebar's md size would
// overflow the 256-px-wide rail. With a cap, the image scales down via
// object-contain to fit, preserving aspect ratio. `logoMinW` keeps the
// tile from collapsing if a future stylesheet bug zeros the height.
const SIZES = {
  sm: { box: "h-6 w-6", logoH: "h-7", logoMinW: "min-w-[28px]", logoMaxW: "max-w-[160px]", text: "text-sm", radius: "rounded-md" },
  md: { box: "h-8 w-8", logoH: "h-12", logoMinW: "min-w-[48px]", logoMaxW: "max-w-[192px]", text: "text-base", radius: "rounded-lg" },
  lg: { box: "h-10 w-10", logoH: "h-16", logoMinW: "min-w-[64px]", logoMaxW: "max-w-[280px]", text: "text-lg", radius: "rounded-xl" },
  xl: { box: "h-14 w-14", logoH: "h-24", logoMinW: "min-w-[96px]", logoMaxW: "max-w-[360px]", text: "text-2xl", radius: "rounded-2xl" },
  "2xl": { box: "h-20 w-20", logoH: "h-36", logoMinW: "min-w-[144px]", logoMaxW: "max-w-[480px]", text: "text-3xl", radius: "rounded-2xl" },
} as const;

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Wordmark({
  name,
  logoPath,
  size = "md",
  showName = true,
  className,
}: WordmarkProps) {
  const s = SIZES[size];

  // Logo uploaded → render the image as the GLYPH and pair it with the
  // app name as a text wordmark. The owner-uploaded logo is a glyph
  // (the "m" mark) — Milo branding still needs to read as words next to
  // it. Callers that already have a full wordmark image can opt out via
  // showName={false}.
  //
  // Light wordmarks (white-on-transparent) vanish on light surfaces; dark
  // wordmarks vanish on dark. Wrap in a neutral surface tile so the logo
  // always has visible separation regardless of the upload's color.
  if (logoPath) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-3 font-semibold tracking-tight antialiased",
          s.text,
          className,
        )}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-lg bg-white px-2 py-1 ring-1 ring-border shadow-sm shrink-0",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoPath}
            alt={name}
            className={cn(
              "w-auto object-contain",
              s.logoH,
              s.logoMinW,
              s.logoMaxW,
            )}
          />
        </span>
        {showName ? (
          <span className="truncate leading-none">{name}</span>
        ) : null}
      </span>
    );
  }

  // Fallback: initials in a brand-coloured square + (optionally) the name.
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 font-semibold tracking-tight",
        s.text,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex items-center justify-center bg-brand-700 text-brand-fg font-mono text-[0.72em] tracking-tight",
          s.box,
          s.radius,
        )}
      >
        {initialsFor(name)}
      </span>
      {showName ? <span className="truncate">{name}</span> : null}
    </span>
  );
}
