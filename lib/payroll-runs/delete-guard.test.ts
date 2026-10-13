import { describe, expect, it } from "vitest";
import { publishedRunDeleteBlocker } from "./delete-guard";

const slip = (over: Partial<Parameters<typeof publishedRunDeleteBlocker>[0]["payslips"][number]> = {}) => ({
  hoursWorked: "0.0000",
  roundedPayCents: 0,
  voidedAt: null,
  acknowledgedAt: null,
  signedAt: null,
  ...over,
});

describe("publishedRunDeleteBlocker", () => {
  it("allows a published run with no payslips at all", () => {
    expect(publishedRunDeleteBlocker({ payslips: [], zohoPushCount: 0 })).toBeNull();
  });

  it("allows a run whose payslips are all zero hours and zero pay", () => {
    expect(
      publishedRunDeleteBlocker({ payslips: [slip(), slip()], zohoPushCount: 0 }),
    ).toBeNull();
  });

  it("ignores a voided payslip that once carried pay", () => {
    expect(
      publishedRunDeleteBlocker({
        payslips: [slip({ roundedPayCents: 48900, hoursWorked: "37.62", voidedAt: new Date() })],
        zohoPushCount: 0,
      }),
    ).toBeNull();
  });

  it("keeps a run with a payslip that has pay", () => {
    const why = publishedRunDeleteBlocker({
      payslips: [slip({ roundedPayCents: 48900, hoursWorked: "37.62" }), slip()],
      zohoPushCount: 0,
    });
    expect(why).toMatch(/1 payslip with hours or pay on it/);
    expect(why).toMatch(/Pay Periods/);
  });

  it("keeps a run with hours even when the pay rounds to zero", () => {
    expect(
      publishedRunDeleteBlocker({ payslips: [slip({ hoursWorked: "0.2500" })], zohoPushCount: 0 }),
    ).toMatch(/hours or pay/);
  });

  it("keeps a run an employee has confirmed, even at zero pay or voided", () => {
    expect(
      publishedRunDeleteBlocker({
        payslips: [slip({ acknowledgedAt: new Date() }), slip({ signedAt: new Date(), voidedAt: new Date() })],
        zohoPushCount: 0,
      }),
    ).toMatch(/2 employees have confirmed or signed/);
  });

  it("keeps a run that was pushed to Zoho", () => {
    expect(publishedRunDeleteBlocker({ payslips: [], zohoPushCount: 1 })).toMatch(/Zoho/);
  });
});
