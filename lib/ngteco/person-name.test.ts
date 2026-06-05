import { describe, expect, it } from "vitest";
import {
  looksLikeDoubledAvatarName,
  sanitizeNgtecoPersonName,
} from "./person-name";

describe("sanitizeNgtecoPersonName", () => {
  it("strips duplicated avatar initial from scraped grid text", () => {
    expect(sanitizeNgtecoPersonName("CCatalina Ramirez")).toBe(
      "Catalina Ramirez",
    );
    expect(sanitizeNgtecoPersonName("SSameer Jessani")).toBe("Sameer Jessani");
  });

  it("leaves normal names alone", () => {
    expect(sanitizeNgtecoPersonName("Amy Lara")).toBe("Amy Lara");
  });
});

describe("looksLikeDoubledAvatarName", () => {
  it("detects doubled initials", () => {
    expect(looksLikeDoubledAvatarName("DDaylin Lopez")).toBe(true);
    expect(looksLikeDoubledAvatarName("Amy Lara")).toBe(false);
  });
});
