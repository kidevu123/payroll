// Rounding rules. Pure, total functions over integer cents and decimal hours.
//
// Money is integer cents — never a float. Hours are decimal but always come
// out of arithmetic on integer-millisecond timestamps, so they can be treated
// as having sub-cent precision without surprise.
//
// The four rules from spec §7:
//   NONE                       — output unchanged.
//   NEAREST_DOLLAR             — round cents to whole dollars, banker's rule.
//   NEAREST_QUARTER            — round cents to nearest $0.25 (25, 50, 75, 100).
//   NEAREST_FIFTEEN_MIN_HOURS  — round each day's hours to nearest 0.25h
//                                BEFORE pay calc; cents are then exact.

export type RoundingRule =
  | "NONE"
  | "NEAREST_DOLLAR"
  | "NEAREST_QUARTER"
  | "NEAREST_FIFTEEN_MIN_HOURS";

/**
 * Round cents to a quantum (in cents, ≥ 2) using **half-up** rounding —
 * the rule the owner's legacy admin reports use. We previously used
 * banker's (half-to-even), which silently underpaid by $1 every time a
 * gross landed on an exact $0.50 (e.g. $580.50 → $580 banker's vs $581
 * half-up). Half-up is the conventional payroll expectation in the US
 * for "round to whole dollars" and matches the legacy reference output.
 */
function halfUpRound(cents: number, quantum: number): number {
  // Math.trunc + sign handling so we round AWAY from zero on .5 (which
  // for cents is always positive in our domain, but kept defensive).
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(cents);
  const q = Math.trunc(abs / quantum);
  const remainder = abs - q * quantum;
  const half = quantum / 2;
  // half-up: ≥ half rounds up.
  return sign * (remainder >= half ? (q + 1) * quantum : q * quantum);
}

/**
 * Apply the cents-rounding rule to a gross amount. NEAREST_FIFTEEN_MIN_HOURS
 * is a no-op here because that rule rounds hours, not cents (apply earlier in
 * the pay-calc pipeline, not at the gross-cents stage).
 */
export function roundCents(cents: number, rule: RoundingRule): number {
  switch (rule) {
    case "NONE":
    case "NEAREST_FIFTEEN_MIN_HOURS":
      return cents;
    case "NEAREST_DOLLAR":
      return halfUpRound(cents, 100);
    case "NEAREST_QUARTER":
      return halfUpRound(cents, 25);
  }
}

/**
 * Round a day's hours to nearest 0.25h, used by NEAREST_FIFTEEN_MIN_HOURS
 * before computing pay. Half-to-even on the 0.125 midpoint.
 */
export function roundDailyHours(hours: number, rule: RoundingRule): number {
  if (rule !== "NEAREST_FIFTEEN_MIN_HOURS") return hours;
  // Work in quarter-hour units so the half-to-even decision is on integers.
  const quarters = hours * 4;
  const floor = Math.floor(quarters);
  const remainder = quarters - floor;
  let rounded: number;
  if (remainder > 0.5) rounded = floor + 1;
  else if (remainder < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1;
  return rounded / 4;
}
