import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(join(__dirname, "layout.tsx"), "utf8");
const globalsSource = readFileSync(join(__dirname, "../globals.css"), "utf8");

describe("admin shell architecture", () => {
  it("does not branch dashboard through a separate visual route", () => {
    expect(layoutSource).not.toContain("isDashboardRoute");
  });

  it("keeps dark mode opt-in instead of making it the admin default", () => {
    expect(layoutSource).toContain('themeCookie === "dark" ? "dark" : ""');
    expect(layoutSource).not.toContain('themeCookie === "light" ? "" : "dark"');
  });

  it("uses the shared workspace canvas for admin pages", () => {
    expect(globalsSource).toContain("background: var(--dash-bg);");
  });
});
