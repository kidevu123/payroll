import { describe, expect, it } from "vitest";
import { normalizeZelleContact, resolvePayoutPreference } from "./zelle-contact";

describe("normalizeZelleContact", () => {
  it("lowercases and trims an email", () => {
    expect(normalizeZelleContact("  Maria.Lopez@Example.COM ")).toBe(
      "maria.lopez@example.com",
    );
  });

  it("normalizes a formatted US phone to E.164", () => {
    expect(normalizeZelleContact("(555) 234-5678")).toBe("+15552345678");
  });

  it("accepts a US phone that already carries the country code", () => {
    expect(normalizeZelleContact("+1 555-234-5678")).toBe("+15552345678");
    expect(normalizeZelleContact("1.555.234.5678")).toBe("+15552345678");
  });

  it("rejects a phone with too few digits", () => {
    expect(normalizeZelleContact("555-1234")).toBeNull();
  });

  it("rejects an 11-digit number that does not start with 1", () => {
    expect(normalizeZelleContact("25552345678")).toBeNull();
  });

  it("rejects a non-US country code", () => {
    expect(normalizeZelleContact("+52 55 1234 5678")).toBeNull();
  });

  it("rejects an area code starting with 0 or 1", () => {
    expect(normalizeZelleContact("055-234-5678")).toBeNull();
    expect(normalizeZelleContact("155-234-5678")).toBeNull();
  });

  it("rejects a malformed email", () => {
    expect(normalizeZelleContact("maria@")).toBeNull();
    expect(normalizeZelleContact("maria lopez@example.com")).toBeNull();
    expect(normalizeZelleContact("maria@example")).toBeNull();
  });

  it("rejects phone-like text containing letters", () => {
    expect(normalizeZelleContact("555-234-5678 ext 2")).toBeNull();
  });

  it("rejects blank input", () => {
    expect(normalizeZelleContact("   ")).toBeNull();
  });

  it("rejects input longer than 254 characters", () => {
    expect(normalizeZelleContact(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("resolvePayoutPreference", () => {
  it("stores a normalized contact for Zelle", () => {
    expect(
      resolvePayoutPreference({
        preference: "ZELLE",
        zelleContact: "555 234 5678",
      }),
    ).toEqual({
      ok: true,
      value: { payoutPreference: "ZELLE", zelleContact: "+15552345678" },
    });
  });

  it("requires a contact for Zelle", () => {
    expect(
      resolvePayoutPreference({ preference: "ZELLE", zelleContact: "  " }),
    ).toEqual({ ok: false, error: "ZELLE_CONTACT_REQUIRED" });
    expect(
      resolvePayoutPreference({ preference: "ZELLE", zelleContact: null }),
    ).toEqual({ ok: false, error: "ZELLE_CONTACT_REQUIRED" });
  });

  it("rejects an invalid contact for Zelle", () => {
    expect(
      resolvePayoutPreference({ preference: "ZELLE", zelleContact: "nope" }),
    ).toEqual({ ok: false, error: "ZELLE_CONTACT_INVALID" });
  });

  it("clears any submitted contact when Cash is chosen", () => {
    expect(
      resolvePayoutPreference({
        preference: "CASH",
        zelleContact: "maria@example.com",
      }),
    ).toEqual({
      ok: true,
      value: { payoutPreference: "CASH", zelleContact: null },
    });
  });

  it("treats an empty preference as not set and clears the contact", () => {
    expect(
      resolvePayoutPreference({
        preference: "",
        zelleContact: "maria@example.com",
      }),
    ).toEqual({
      ok: true,
      value: { payoutPreference: null, zelleContact: null },
    });
    expect(
      resolvePayoutPreference({ preference: null, zelleContact: null }),
    ).toEqual({
      ok: true,
      value: { payoutPreference: null, zelleContact: null },
    });
  });

  it("rejects an unknown preference", () => {
    expect(
      resolvePayoutPreference({ preference: "VENMO", zelleContact: null }),
    ).toEqual({ ok: false, error: "PREFERENCE_INVALID" });
  });
});
