import { describe, expect, it } from "vitest";
import { deriveAuthentikUsername } from "./username";

describe("deriveAuthentikUsername (matches the live directory convention)", () => {
  it("is first name plus last initial, lowercased", () => {
    expect(deriveAuthentikUsername({ name: "Juan Herrera", email: "juan@gmail.com" })).toBe("juanh");
    expect(deriveAuthentikUsername({ name: "Sahil Khatri", email: "sahil@boomin.com" })).toBe("sahilk");
  });

  it("uses the last word as the surname when there are middle names", () => {
    expect(deriveAuthentikUsername({ name: "Ana Maria Gomez", email: "a@x.com" })).toBe("anag");
  });

  it("strips accents, spaces, and punctuation", () => {
    expect(deriveAuthentikUsername({ name: "José O'Neill-Vega", email: "j@x.com" })).toBe("joseo");
  });

  it("falls back to the first name alone when there is no surname", () => {
    expect(deriveAuthentikUsername({ name: "Eshal", email: "e@x.com" })).toBe("eshal");
  });

  it("falls back to the email local-part when the name is empty or unusable", () => {
    expect(deriveAuthentikUsername({ name: null, email: "Payroll.Admin@boomin.com" })).toBe("payrolladmin");
    expect(deriveAuthentikUsername({ name: "   ", email: "chintu@gmail.com" })).toBe("chintu");
  });

  it("never returns an empty string", () => {
    expect(deriveAuthentikUsername({ name: "!!!", email: "!!!@x.com" }).length).toBeGreaterThan(0);
  });
});
