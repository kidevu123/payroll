// When may a PUBLISHED payroll run be deleted from Reports?
//
// A published run is normally kept: its payslips are pay history owed to
// employees and the accountant. But "published" alone does not mean there is
// any history. The scheduler publishes a run for every period, including one
// nobody worked, and that leaves a $0.00 report with no payslips that could
// never be removed. Such a run has nothing to preserve.

export type RunPayslipFacts = {
  hoursWorked: string | number;
  roundedPayCents: number;
  voidedAt: Date | string | null;
  acknowledgedAt: Date | string | null;
  signedAt: Date | string | null;
};

/**
 * Why a published run must be kept, in words for the person clicking Delete,
 * or null when it is empty and safe to remove.
 */
export function publishedRunDeleteBlocker(facts: {
  payslips: readonly RunPayslipFacts[];
  zohoPushCount: number;
}): string | null {
  const confirmed = facts.payslips.filter((p) => p.acknowledgedAt || p.signedAt).length;
  if (confirmed > 0) {
    return `${confirmed} employee${confirmed === 1 ? " has" : "s have"} confirmed or signed a payslip on this report, so it is kept as pay history.`;
  }
  const withPay = facts.payslips.filter(
    (p) => !p.voidedAt && (Number(p.hoursWorked) !== 0 || p.roundedPayCents !== 0),
  ).length;
  if (withPay > 0) {
    return `This report has ${withPay} payslip${withPay === 1 ? "" : "s"} with hours or pay on ${withPay === 1 ? "it" : "them"}, so it is kept as pay history. To remove the whole period anyway, use the delete button on its row in Pay Periods.`;
  }
  if (facts.zohoPushCount > 0) {
    return "This report was pushed to Zoho Books, so it is kept to match the expense recorded there.";
  }
  return null;
}

/** Thrown by deleteRun when the run must be kept; the message is user-facing. */
export class RunDeleteRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunDeleteRefusedError";
  }
}
