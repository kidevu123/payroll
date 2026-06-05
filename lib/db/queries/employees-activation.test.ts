import { describe, expect, it } from "vitest";
import { activationRequirementsMessage } from "./employees";

describe("activationRequirementsMessage", () => {
  it("allows salaried without rate or schedule", () => {
    expect(
      activationRequirementsMessage({
        payType: "SALARIED",
        payScheduleId: null,
        hourlyRateCents: null,
      }),
    ).toBeNull();
  });

  it("requires schedule and rate for hourly", () => {
    expect(
      activationRequirementsMessage({
        payType: "HOURLY",
        payScheduleId: null,
        hourlyRateCents: 1200,
      }),
    ).toBe(
      "Choose a classification with an active pay schedule before activating.",
    );
    expect(
      activationRequirementsMessage({
        payType: "HOURLY",
        payScheduleId: "sched-1",
        hourlyRateCents: null,
      }),
    ).toBe("Set an hourly rate before activating.");
  });
});
