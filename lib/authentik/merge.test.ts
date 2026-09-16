import { describe, expect, it } from "vitest";
import { computeProfileMerge } from "./merge";

const base = {
  payrollEmail: "juan@gmail.com",
  payrollDisplayName: "Juan H",
  idpEmail: "juan@gmail.com",
  idpName: "Juan H",
  emailTakenByAnotherUser: false,
};

describe("computeProfileMerge (Authentik owns name + email, nothing else)", () => {
  it("proposes nothing when both sides already agree", () => {
    const m = computeProfileMerge(base);
    expect(m.email).toBeNull();
    expect(m.displayName).toBeNull();
    expect(m.conflicts).toEqual([]);
  });

  it("adopts the IdP email when it differs", () => {
    const m = computeProfileMerge({ ...base, idpEmail: "juan.herrera@boomin.com" });
    expect(m.email).toEqual({ from: "juan@gmail.com", to: "juan.herrera@boomin.com" });
  });

  it("treats email comparison as case-insensitive", () => {
    const m = computeProfileMerge({ ...base, idpEmail: "Juan@Gmail.com" });
    expect(m.email).toBeNull();
  });

  it("adopts the IdP display name when it differs", () => {
    const m = computeProfileMerge({ ...base, idpName: "Juan Herrera" });
    expect(m.displayName).toEqual({ from: "Juan H", to: "Juan Herrera" });
  });

  it("ignores empty or whitespace-only IdP values rather than blanking ours", () => {
    const m = computeProfileMerge({ ...base, idpName: "   ", idpEmail: "" });
    expect(m.email).toBeNull();
    expect(m.displayName).toBeNull();
  });

  it("refuses an email already owned by another payroll user, and says so", () => {
    const m = computeProfileMerge({
      ...base,
      idpEmail: "seri@boomin.com",
      emailTakenByAnotherUser: true,
    });
    expect(m.email).toBeNull();
    expect(m.conflicts).toEqual([
      { field: "email", reason: "taken-by-another-payroll-user", value: "seri@boomin.com" },
    ]);
  });

  it("proposes a display name even when the payroll side has none", () => {
    const m = computeProfileMerge({ ...base, payrollDisplayName: null, idpName: "Juan Herrera" });
    expect(m.displayName).toEqual({ from: "", to: "Juan Herrera" });
  });
});
