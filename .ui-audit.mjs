import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const BASE = "http://localhost:3010";
const SUFFIX = process.argv[2] ?? "x";
const OUT = `/private/tmp/claude-501/-Users-kidevu/5c4037a6-64e2-4dd8-b2b3-c0bc9a25699d/scratchpad/audit-${SUFFIX}/`;
const ROUTES = [["dashboard","/dashboard"],["payroll","/payroll"],["reports","/reports"],["employees","/employees"],["time","/time"],["salaried","/salaried"],["calendar","/calendar"],["cash-drawer","/cash-drawer"],["notifications","/notifications"],["settings","/settings"],["audit","/audit"],["punches","/punches"],["hall-monitor","/hall-monitor"]];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page.locator('input[name="email"]').pressSequentially("owner@local.test");
await page.locator('input[name="password"]').pressSequentially("LocalDev!2026");
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 25000 }).catch(() => {});
const periodHref = await (async () => {
  await page.goto(`${BASE}/payroll`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  return page.locator('a[href^="/payroll/"]').first().getAttribute("href").catch(() => null);
})();
if (periodHref) ROUTES.push(["period-detail", periodHref]);
for (const [name, path] of ROUTES) {
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
    console.log(name, "ok");
  } catch (e) { console.log(name, "FAIL", String(e).slice(0,70)); }
}
await browser.close();
