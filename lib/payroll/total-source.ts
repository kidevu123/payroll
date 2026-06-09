export function shouldUseStoredPayrollTotals(args: {
  periodState: string;
  runSource?: string | null;
  publishedToPortalAt?: Date | string | null;
  payslipSumCents: number;
  liveRoundedCents: number;
}): boolean {
  return (
    args.periodState === "PAID" ||
    !!args.publishedToPortalAt ||
    args.runSource === "LEGACY_IMPORT" ||
    (args.payslipSumCents > 0 && args.liveRoundedCents === 0)
  );
}

