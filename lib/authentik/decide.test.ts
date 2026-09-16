import { describe, expect, it } from "vitest";
import { decideProvision } from "./decide";

const base = {
  alreadyLinked: false,
  disabled: false,
  email: "juan@gmail.com",
  candidateUsername: "juanh",
  matchByEmail: null,
  usernameTaken: false,
};

describe("decideProvision", () => {
  it("creates when nothing in the IdP matches", () => {
    expect(decideProvision(base)).toEqual({ action: "create", username: "juanh" });
  });

  it("links when an Authentik account already has that email", () => {
    expect(
      decideProvision({ ...base, matchByEmail: { pk: 7, username: "juanh" } }),
    ).toEqual({ action: "link", authentikPk: 7, username: "juanh" });
  });

  it("is a no-op for an already-linked user", () => {
    expect(decideProvision({ ...base, alreadyLinked: true })).toEqual({
      action: "skip",
      reason: "already-linked",
    });
  });

  it("skips disabled payroll users", () => {
    expect(decideProvision({ ...base, disabled: true })).toEqual({
      action: "skip",
      reason: "disabled",
    });
  });

  it("skips a user with no email", () => {
    expect(decideProvision({ ...base, email: "  " })).toEqual({
      action: "skip",
      reason: "no-email",
    });
  });

  it("refuses to guess when the username is taken by an account with a different email", () => {
    expect(decideProvision({ ...base, usernameTaken: true })).toEqual({
      action: "needs-review",
      reason: "username-taken",
      username: "juanh",
    });
  });

  it("prefers an email match over the username-taken check", () => {
    expect(
      decideProvision({
        ...base,
        usernameTaken: true,
        matchByEmail: { pk: 7, username: "juanh" },
      }),
    ).toEqual({ action: "link", authentikPk: 7, username: "juanh" });
  });

  it("checks already-linked before anything else", () => {
    expect(
      decideProvision({ ...base, alreadyLinked: true, disabled: true, email: "" }),
    ).toEqual({ action: "skip", reason: "already-linked" });
  });
});
