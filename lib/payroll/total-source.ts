/**
 * Should the period detail page render the STORED payslip totals (the
 * frozen truth from a payroll run) instead of live punch math?
 *
 * Stored wins for paid / employee-visible / legacy periods — history must
 * not silently recompute. But stored data has to actually exist: a period
 * can be locked and marked PAID without a run ever being generated (e.g. a
 * monthly period whose real pay is an uploaded W2 paystub). Rendering the
 * empty stored source there showed "0 emp · $0.00" for a period that paid
 * real money, so with no payslips at all we keep showing the live totals.
 */
export function shouldUseStoredPayrollTotals(args: {
  periodState: string;
  runSource?: string | null;
  publishedToPortalAt?: Date | string | null;
  payslipSumCents: number;
  liveRoundedCents: number;
}): boolean {
  const hasStored = args.payslipSumCents > 0;
  return (
    hasStored &&
    (args.periodState === "PAID" ||
      !!args.publishedToPortalAt ||
      args.runSource === "LEGACY_IMPORT" ||
      args.liveRoundedCents === 0)
  );
}
