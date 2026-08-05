// Dashboard palette — now theme-aware via CSS variables.
//
// These constants resolve to `var(--dash-*)` custom properties defined in
// app/globals.css. The DARK values (under `.dark`) match the original
// self-contained dark canvas exactly; the LIGHT values give the dashboard a
// clean light surface (the #58 aesthetic) when the theme toggle is set to
// light. Because every dashboard component references these constants (never
// raw hex), the whole surface flips light/dark with zero component edits.
//
// Inline styles (`style={{ background: DASH.surface }}`) and recharts string
// props (`stroke={CHART.cyan}`) both accept `var(--x)` — it resolves in the
// CSS cascade and in SVG attributes.

export const DASH = {
  // Surfaces
  bg: "var(--dash-bg)",
  surface: "var(--dash-surface)",
  surfaceRaised: "var(--dash-surface-raised)",
  border: "var(--dash-border)",
  borderStrong: "var(--dash-border-strong)",

  // Chrome surfaces (sidebar / topbar / search field / hover state)
  sidebar: "var(--dash-sidebar)",
  topbar: "var(--dash-topbar)",
  search: "var(--dash-search)",
  hover: "var(--dash-hover)",

  // Text
  text: "var(--dash-text)",
  textMuted: "var(--dash-text-muted)",
  textFaint: "var(--dash-text-faint)",

  // Accents
  cyan: "var(--dash-cyan)",
  cyanBright: "var(--dash-cyan-bright)",
  blue: "var(--dash-blue)",
  emerald: "var(--dash-emerald)",
  emeraldDim: "var(--dash-emerald-dim)",
  rose: "var(--dash-rose)",
  amber: "var(--dash-amber)",
} as const;

/** Chart-specific colors. recharts accepts `var(--x)` in stroke/fill/stop. */
export const CHART = {
  cyan: DASH.cyan,
  cyanBright: DASH.cyanBright,
  emerald: DASH.emerald,
  emeraldDim: DASH.emeraldDim,
  grid: "var(--dash-chart-grid)",
  axis: "var(--dash-chart-axis)",
  tooltipBg: "var(--dash-surface-raised)",
  tooltipBorder: "var(--dash-border-strong)",
} as const;
