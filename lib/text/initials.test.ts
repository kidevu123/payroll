import { describe, expect, it } from "vitest";
import { initialsFor } from "./initials";

describe("initialsFor", () => {
  it("first and last initial of a multi-word name, upper-cased", () => {
    expect(initialsFor("marcus brown")).toBe("MB");
    expect(initialsFor("  Ana  María   de la Cruz ")).toBe("AC");
  });
  it("the first two letters of a single word", () => {
    expect(initialsFor("Payroll")).toBe("PA");
    expect(initialsFor("x")).toBe("X");
  });
  it("an empty name gives the fallback: an em dash unless the caller names another", () => {
    expect(initialsFor("")).toBe("—");
    expect(initialsFor("   ")).toBe("—");
    expect(initialsFor("", "P")).toBe("P");
    expect(initialsFor(" ", "?")).toBe("?");
  });
});
