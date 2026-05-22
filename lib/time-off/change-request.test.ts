import { describe, expect, it } from "vitest";
import {
  isEmployeeEditableTimeOff,
  timeOffChangeApprovalPlan,
} from "./change-request";

describe("time-off change requests", () => {
  it("lets employees change approved current or upcoming time off", () => {
    expect(
      isEmployeeEditableTimeOff(
        { status: "APPROVED", endDate: "2026-05-22" },
        "2026-05-22",
      ),
    ).toBe(true);
    expect(
      isEmployeeEditableTimeOff(
        { status: "APPROVED", endDate: "2026-05-23" },
        "2026-05-22",
      ),
    ).toBe(true);
    expect(
      isEmployeeEditableTimeOff(
        { status: "PENDING", endDate: "2026-05-23" },
        "2026-05-22",
      ),
    ).toBe(false);
    expect(
      isEmployeeEditableTimeOff(
        { status: "APPROVED", endDate: "2026-05-21" },
        "2026-05-22",
      ),
    ).toBe(false);
  });

  it("keeps the old approval when an employee change is rejected", () => {
    expect(timeOffChangeApprovalPlan("EDIT", "REJECTED")).toEqual({
      resolveChangeAs: "REJECTED",
      cancelOriginal: false,
    });
    expect(timeOffChangeApprovalPlan("CANCEL", "REJECTED")).toEqual({
      resolveChangeAs: "REJECTED",
      cancelOriginal: false,
    });
  });

  it("cancels the old approval when an employee edit is approved", () => {
    expect(timeOffChangeApprovalPlan("EDIT", "APPROVED")).toEqual({
      resolveChangeAs: "APPROVED",
      cancelOriginal: true,
    });
  });

  it("turns an approved employee cancellation request into cancellation rows", () => {
    expect(timeOffChangeApprovalPlan("CANCEL", "APPROVED")).toEqual({
      resolveChangeAs: "CANCELLED",
      cancelOriginal: true,
    });
  });
});
