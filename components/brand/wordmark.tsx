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

// `logoMaxW` caps how wide the rendered logo can grow. `logoMinW` keeps
// the slot from collapsing if a future stylesheet bug zeros the height.
//
// Sized down vs the prior version — sidebar logos in premium products
// (Linear, Stripe, Vercel) sit at h-6 to h-8 with the wordmark beside,
// not in a giant sticker. The owner-uploaded glyph is rendered raw
// (no white tile, no border, no shadow) so it reads as part of the
// chrome rather than a pasted-on graphic.
const SIZES = {
  sm: { box: "h-5 w-5", logoH: "h-5", logoMinW: "min-w-[20px]", logoMaxW: "max-w-[120px]", text: "text-sm", radius: "rounded-md" },
  md: { box: "h-7 w-7", logoH: "h-7", logoMinW: "min-w-[28px]", logoMaxW: "max-w-[160px]", text: "text-base", radius: "rounded-md" },
  lg: { box: "h-9 w-9", logoH: "h-10", logoMinW: "min-w-[40px]", logoMaxW: "max-w-[220px]", text: "text-lg", radius: "rounded-lg" },
  xl: { box: "h-12 w-12", logoH: "h-16", logoMinW: "min-w-[64px]", logoMaxW: "max-w-[320px]", text: "text-2xl", radius: "rounded-xl" },
  "2xl": { box: "h-16 w-16", logoH: "h-24", logoMinW: "min-w-[96px]", logoMaxW: "max-w-[420px]", text: "text-3xl", radius: "rounded-xl" },
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

  // Logo uploaded → render the glyph naked next to the wordmark. No
  // tile, no border, no shadow — premium SaaS sidebars (Linear, Stripe,
  // Vercel) treat the glyph as a typographic element, not a sticker.
  // The branding/storage layer trims transparent whitespace on upload,
  // so the glyph fits its bounding box without extra padding here.
  if (logoPath) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2.5 font-semibold tracking-tight antialiased",
          s.text,
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoPath}
          alt={name}
          className={cn(
            "w-auto object-contain shrink-0",
            s.logoH,
            s.logoMinW,
            s.logoMaxW,
          )}
        />
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
