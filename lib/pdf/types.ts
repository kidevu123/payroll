// Shared PDF input types so the renderer + the publish job + the snapshot
// tests all agree.

export type PayslipDocInput = {
  company: {
    name: string;
    address: string;
    brandColorHex: string;
    locale: string;
  };
  employee: {
    displayName: string;
    legalName: string;
    legacyId: string | null;
    shiftName: string | null;
    /**
     * Hourly rate in cents — displayed in the compact "ID: X | Rate: $Y |
     * Shift: Z" header line. Optional so legacy callers and tests don't
     * have to supply it.
     */
    hourlyRateCents?: number | null;
  };
  period: { startDate: string; endDate: string };
  rules: {
    rounding: string;
    hoursDecimalPlaces: number;
  };
  /**
   * One row per worked day. inTime/outTime are wall-clock HH:MM:SS strings
   * formatted in the company timezone — they're optional so that the test
   * fixture and the (rare) salaried/task-pay-only payslip don't have to
   * fabricate them. When absent, the daily table renders blank In/Out cells.
   */
  days: {
    date: string;
    hours: number;
    cents: number;
    isOvertime: boolean;
    inTime?: string;
    outTime?: string;
  }[];
  totals: {
    hours: number;
    regularCents: number;
    overtimeCents: number;
    taskCents: number;
    grossCents: number;
    roundedCents: number;
  };
  taskPay: { description: string; amountCents: number }[];
  generatedAt: string;
};

export type SignatureReportInput = {
  company: { name: string; brandColorHex: string };
  period: { startDate: string; endDate: string };
  rows: {
    shiftName: string;
    employeeName: string;
    legacyId: string | null;
    hours: number;
    roundedCents: number;
  }[];
  generatedAt: string;
};

export type CutSheetInput = {
  company: { name: string; brandColorHex: string };
  period: { startDate: string; endDate: string };
  cards: {
    employeeName: string;
    legacyId: string | null;
    hours: number;
    roundedCents: number;
  }[];
  generatedAt: string;
};

/**
 * Combined admin period report — one section per employee in the legacy
 * "Date / In / Out / Hours / Pay" format, then a final-page Payroll Summary
 * with shift subtotals + grand total. Replaces the old SignatureReport.
 */
export type AdminReportInput = {
  company: {
    name: string;
    address: string;
    brandColorHex: string;
    locale: string;
  };
  period: { startDate: string; endDate: string };
  rules: {
    rounding: string;
    hoursDecimalPlaces: number;
  };
  employees: {
    displayName: string;
    legalName: string;
    legacyId: string | null;
    shiftName: string | null;
    hourlyRateCents: number | null;
    days: {
      date: string;
      hours: number;
      cents: number;
      isOvertime: boolean;
      inTime?: string;
      outTime?: string;
    }[];
    totals: {
      hours: number;
      regularCents: number;
      overtimeCents: number;
      taskCents: number;
      grossCents: number;
      roundedCents: number;
    };
    taskPay: { description: string; amountCents: number }[];
  }[];
  generatedAt: string;
};
