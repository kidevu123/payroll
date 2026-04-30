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
  };
  period: { startDate: string; endDate: string };
  rules: {
    rounding: string;
    hoursDecimalPlaces: number;
  };
  days: { date: string; hours: number; cents: number; isOvertime: boolean }[];
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
