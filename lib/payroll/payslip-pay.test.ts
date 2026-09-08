import { describe, expect, it } from "vitest";
import { payslipHasPay } from "./payslip-pay";

const zero = { hoursWorked: "0.0000", grossPayCents: 0, taskPayCents: 0, roundedPayCents: 0 };

describe("payslipHasPay", () => {
  it("is false for a did-not-work week", () => {
    expect(payslipHasPay(zero)).toBe(false);
  });

  it("is true when any pay component is present", () => {
    expect(payslipHasPay({ ...zero, hoursWorked: "0.2500" })).toBe(true);
    expect(payslipHasPay({ ...zero, grossPayCents: 1 })).toBe(true);
    expect(payslipHasPay({ ...zero, taskPayCents: 500 })).toBe(true);
    expect(payslipHasPay({ ...zero, roundedPayCents: 100 })).toBe(true);
  });

  it("accepts numeric hours too", () => {
    expect(payslipHasPay({ ...zero, hoursWorked: 8 })).toBe(true);
    expect(payslipHasPay({ ...zero, hoursWorked: 0 })).toBe(false);
  });
});
