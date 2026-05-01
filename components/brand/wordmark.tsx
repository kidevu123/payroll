// Wordmark: company logo (or initials in a brand-tinted square) + name.
// Used in the auth panel, sidebar header, and PWA splash. Pure presentation —
// callers pass the company record (name, logoPath optional). No fetching here
// so it can render in both server and client trees without async friction.

import { cn } from "@/lib/utils";

export type WordmarkProps = {
  name: string;
  logoPath?: string | null;
  size?: "sm" | "md" | "lg";
  showName?: boolean;
  className?: string;
};

const SIZES = {
  sm: { box: "h-6 w-6", text: "text-sm", radius: "rounded-md" },
  md: { box: "h-8 w-8", text: "text-base", radius: "rounded-lg" },
  lg: { box: "h-10 w-10", text: "text-lg", radius: "rounded-xl" },
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
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 font-semibold tracking-tight",
        s.text,
        className,
      )}
    >
      {logoPath ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoPath}
          alt=""
          className={cn("object-contain", s.box, s.radius)}
        />
      ) : (
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
      )}
      {showName ? <span className="truncate">{name}</span> : null}
    </span>
  );
}
