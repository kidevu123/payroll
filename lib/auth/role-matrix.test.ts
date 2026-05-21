import { describe, expect, it } from "vitest";
import { isAccountantPeriodReviewPath } from "./role-matrix";

describe("isAccountantPeriodReviewPath", () => {
  it("allows a single payroll period route", () => {
    expect(
      isAccountantPeriodReviewPath(
        "/payroll/eef493fa-2c29-47e1-b32c-c1e3b64b1722",
      ),
    ).toBe(true);
    expect(isAccountantPeriodReviewPath("/payroll/period-1/")).toBe(true);
  });

  it("does not open the payroll workspace or run routes", () => {
    expect(isAccountantPeriodReviewPath("/payroll")).toBe(false);
    expect(isAccountantPeriodReviewPath("/payroll/run/run-1")).toBe(false);
  });
});
