// Visual regression screenshots. Boots a headless Chromium, snaps the surfaces
// that changed in Phase 6.5 visual lift, writes PNGs into ./screenshots/.
//
// Usage:
//   tsx scripts/screenshots.ts <BASE_URL> [<EMAIL> <PASSWORD>]
//
// If credentials are passed it signs in and snaps the authed surfaces too.
// Otherwise it covers /login and /setup only. The script never seeds data —
// pass it against an environment that already has demo or legacy content.

import { chromium, type BrowserContext } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

type Shot = { name: string; path: string; viewport: "desktop" | "mobile" };

const PUBLIC_SHOTS: Shot[] = [
  { name: "login-desktop", path: "/login", viewport: "desktop" },
  { name: "login-mobile", path: "/login", viewport: "mobile" },
  { name: "setup-desktop", path: "/setup", viewport: "desktop" },
];

const AUTHED_SHOTS: Shot[] = [
  { name: "dashboard-desktop", path: "/dashboard", viewport: "desktop" },
  { name: "employees-desktop", path: "/employees", viewport: "desktop" },
  { name: "payroll-desktop", path: "/payroll", viewport: "desktop" },
  { name: "style-guide-desktop", path: "/internal/style-guide", viewport: "desktop" },
  { name: "me-home-mobile", path: "/me/home", viewport: "mobile" },
  { name: "me-pay-mobile", path: "/me/pay", viewport: "mobile" },
  { name: "me-profile-mobile", path: "/me/profile", viewport: "mobile" },
];

const VIEWPORT = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

async function snap(ctx: BrowserContext, base: string, shot: Shot, outDir: string) {
  const page = await ctx.newPage();
  await page.setViewportSize(VIEWPORT[shot.viewport]);
  const url = base + shot.path;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    // Wait for fonts so the wordmark doesn't render in fallback Inter.
    await page.evaluate(() => (document as Document & { fonts?: { ready: Promise<void> } }).fonts?.ready);
    const out = join(outDir, `${shot.name}.png`);
    await page.screenshot({ path: out, fullPage: shot.viewport === "desktop" });
    console.log(`OK  ${shot.name}  ${url}  -> ${out}`);
  } catch (err) {
    console.error(`FAIL ${shot.name}  ${url}  ${(err as Error).message}`);
    throw err;
  } finally {
    await page.close();
  }
}

async function signIn(
  ctx: BrowserContext,
  base: string,
  email: string,
  password: string,
): Promise<boolean> {
  const page = await ctx.newPage();
  try {
    await page.goto(base + "/login", { waitUntil: "networkidle", timeout: 20000 });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForURL((u) => !u.toString().includes("/login"), { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ]);
    return true;
  } catch (err) {
    console.error(`sign-in failed: ${(err as Error).message}`);
    return false;
  } finally {
    await page.close();
  }
}

async function main() {
  const [, , baseRaw, email, password] = process.argv;
  if (!baseRaw) {
    console.error("usage: tsx scripts/screenshots.ts <BASE> [<EMAIL> <PASSWORD>]");
    process.exit(2);
  }
  const base = baseRaw.replace(/\/$/, "");
  const outDir = join(process.cwd(), "screenshots");
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });

  try {
    for (const s of PUBLIC_SHOTS) await snap(ctx, base, s, outDir);
    if (email && password) {
      const ok = await signIn(ctx, base, email, password);
      if (ok) {
        for (const s of AUTHED_SHOTS) await snap(ctx, base, s, outDir);
      } else {
        process.exitCode = 1;
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
