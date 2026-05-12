import { describe, expect, it } from "vitest";
import { normalizePrintablePersonName } from "./build-admin-report";

describe("normalizePrintablePersonName", () => {
  it("normalizes legacy temp prefixes to the matching employee name", () => {
    expect(normalizePrintablePersonName("TEMP_004_Chintu Bolle")).toBe(
      "chintu bolle",
    );
    expect(normalizePrintablePersonName("004_Chintu Bolle")).toBe(
      "chintu bolle",
    );
    expect(normalizePrintablePersonName("Chintu Bolle")).toBe("chintu bolle");
  });

  it("collapses punctuation and whitespace for duplicate detection", () => {
    expect(normalizePrintablePersonName("  Chintu   Bolle  ")).toBe(
      "chintu bolle",
    );
    expect(normalizePrintablePersonName("Chintu-Bolle")).toBe("chintu bolle");
  });
});
