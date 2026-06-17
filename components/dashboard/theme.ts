// Self-contained dark palette for the showcase dashboard ONLY.
//
// The rest of the app is light. These tokens live here (not in
// app/globals.css) so the dashboard renders as its own dark canvas without
// touching global theme values or enabling app-wide dark mode. Components
// reference these via Tailwind arbitrary values (bg-[var(--...)] / explicit
// hex) scoped under the dashboard's dark container.

export const DASH = {
  // Surfaces
  bg: "#0b0b12", // deep near-black canvas
  surface: "#16161f", // card surface
  surfaceRaised: "#1c1c28", // hovered / nested surface
  border: "rgba(255,255,255,0.08)", // hairline 1px border
  borderStrong: "rgba(255,255,255,0.14)",

  // Text (all ≥ 4.5:1 on #0b0b12 / #16161f)
  text: "#f4f4f8",
  textMuted: "#a1a1b5",
  textFaint: "#6e6e85",

  // Accents
  violet: "#8b5cf6",
  violetBright: "#a78bfa",
  indigo: "#6366f1",
  emerald: "#34d399",
  emeraldDim: "#10b981",
  rose: "#fb7185",
  amber: "#fbbf24",
} as const;

/** Chart-specific hex (recharts wants plain strings, not CSS vars). */
export const CHART = {
  violet: DASH.violet,
  violetBright: DASH.violetBright,
  emerald: DASH.emerald,
  grid: "rgba(255,255,255,0.06)",
  axis: "#6e6e85",
  tooltipBg: "#1c1c28",
  tooltipBorder: "rgba(255,255,255,0.14)",
} as const;
