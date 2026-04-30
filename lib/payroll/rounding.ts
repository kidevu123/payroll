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
 * Round cents to a quantum (in cents, ≥ 2) using banker's rounding
 * (half-to-even). Banker's matches the "NEAREST_DOLLAR" rule's payroll
 * convention so a stream of $0.50-half rounds doesn't bias the total upward.
 */
function bankersRound(cents: number, quantum: number): number {
  const q = Math.trunc(cents / quantum);
  const remainder = cents - q * quantum;
  const half = quantum / 2;
  if (remainder > half) return (q + 1) * quantum;
  if (remainder < half) return q * quantum;
  // Exactly half — pick the even multiple.
  return (q % 2 === 0 ? q : q + 1) * quantum;
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
      return bankersRound(cents, 100);
    case "NEAREST_QUARTER":
      return bankersRound(cents, 25);
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
