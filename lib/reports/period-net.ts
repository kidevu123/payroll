/**
 * Canonical period NET — the actual take-home paid out for one pay period.
 *
 * For salaried / W2 employees the run computes pay UNTAXED (≈ gross), but the
 * uploaded paystub carries the real after-tax net. So we SWAP: drop the run net
 * of employees who have a paystub (replacedRunNetCents) and add the paystub net
 * (docNetPayCents). Hourly employees (no paystub) keep their run net, so a mixed
 * period stays correct. Plus per-period temp labor. No double-count; net never
 * exceeds gross.
 *
 * Single source of truth shared by the Reports table (per-period rows) and the
 * Reports overview (KPI / net-trend / YTD-paid) so the two can never drift —
 * that drift is exactly what overstated the overview's net for salaried periods.
 */
export function periodNetCents(p: {
  /** Sum of run amounts (amountCents) across the period's runs. */
  runTotalCents: number;
  replacedRunNetCents: number;
  docNetPayCents: number;
  tempLaborCents: number;
}): number {
  return (
    p.runTotalCents -
    p.replacedRunNetCents +
    p.docNetPayCents +
    p.tempLaborCents
  );
}
