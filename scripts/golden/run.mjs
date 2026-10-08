// usage: node scripts/golden/run.mjs record|check
// Starts the BUILT app (run `npx next build` first) on :3111 against
// .env.golden.local under a frozen clock, fetches each route as the owner and
// the employee, normalizes the HTML and records or compares tests/golden/.
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const mode = process.argv[2];
if (mode !== "record" && mode !== "check") { console.error("usage: run.mjs record|check"); process.exit(2); }
config({ path: join(ROOT, ".env.golden.local") });
const BASE = "http://localhost:3111";
const GOLDEN_NOW = "2026-10-06T18:00:00Z";
const OUT = join(ROOT, "tests", "golden");

// Ids resolved from the scratch DB so filenames stay stable.
const q = (sql) => execSync(`psql -d payroll_mobile_ui -Atc "${sql.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const lockedWeekly = q("select id from pay_periods where start_date='2026-09-28'");
const openWeekly = q("select id from pay_periods where state='OPEN' and end_date-start_date=6 order by start_date desc limit 1");
const monthly = q("select id from pay_periods where end_date-start_date>20 order by start_date desc limit 1");
const paidCash = q("select id from pay_periods where payment_method='CASH' limit 1");
const marcus = q("select id from employees where display_name='Marcus Brown'");

const ROUTES = [
  ["owner", "time", "/time"],
  ["owner", "time-weekly", "/time?schedule=weekly"],
  ["owner", "time-monthly", "/time?schedule=monthly"],
  ["owner", "time-salaried", "/time?schedule=salaried"],
  ["owner", "time-day", "/time?day=2026-10-05"],
  ["owner", "time-locked-period", `/time?period=${lockedWeekly}`],
  ["owner", "reports", "/reports"],
  ["owner", "reports-2026", "/reports?year=2026"],
  ["owner", "reports-2025", "/reports?year=2025"],
  ["owner", "reports-employees", "/reports?tab=employees"],
  ["owner", "reports-schedules", "/reports?tab=schedules"],
  ["owner", "reports-methods", "/reports?tab=methods"],
  ["owner", "reports-weekly", "/reports?schedule=weekly"],
  ["owner", "reports-monthly", "/reports?schedule=monthly"],
  ["owner", "payroll", "/payroll"],
  ["owner", "payroll-locked-weekly", `/payroll/${lockedWeekly}`],
  ["owner", "payroll-open-weekly", `/payroll/${openWeekly}`],
  ["owner", "payroll-monthly", `/payroll/${monthly}`],
  ["owner", "payroll-paid-cash", `/payroll/${paidCash}`],
  ["owner", "calendar", "/calendar"],
  ["owner", "calendar-agenda", "/calendar?tab=agenda"],
  ["owner", "calendar-totals", "/calendar?tab=totals"],
  ["owner", "calendar-september", "/calendar?year=2026&month=9"],
  ["owner", "payroll-salaried", "/payroll?schedule=salaried"],
  ["owner", "run-payroll-upload", "/run-payroll/upload"],
  ["owner", "day-complete", `/time/${openWeekly}/2026-10-05/${marcus}`],
  ["owner", "day-open-punch", `/time/${openWeekly}/2026-10-09/${marcus}`],
  ["owner", "day-paid-period", `/time/${paidCash}/2026-09-22/${marcus}`],
  ["owner", "requests", "/requests"],
  ["employee", "me-home", "/me/home"],
  ["employee", "me-time", "/me/time"],
  ["employee", "me-pay", "/me/pay"],
];

// React streams late segments as hidden containers appended to the document
// plus an inline script that moves each into its <template id="P:n"> (segment)
// or <template id="B:n"> (Suspense boundary) slot. The container depends on
// where the slot sits: <div hidden id="S:n"> for block content, but
// <table hidden><tbody><tr id="S:n"> for table rows, <svg style="display:none"
// id="S:n"> for icon paths, and so on. WHERE a segment lands depends on timing, so the
// raw stream is not stable run to run even when the page is. Do what the
// browser does: move every segment into its slot, then drop the markers.
function endOfElement(html, openStart, tag) {
  // Index just past the </tag> that closes the element opened at openStart.
  const re = new RegExp(`<\\/?${tag}\\b[^>]*>`, "g");
  re.lastIndex = openStart;
  let depth = 0;
  let t;
  while ((t = re.exec(html))) {
    if (t[0].startsWith("</")) depth--;
    else if (!t[0].endsWith("/>")) depth++;
    if (depth === 0) return re.lastIndex;
  }
  return -1;
}

function resolveStreaming(html) {
  const segs = new Map();
  let out = html;
  const hidden = /<(div|table|svg|tbody|thead|tr|td|ul|ol|li|span|p|section|article|select|optgroup) hidden\b[^>]*>/g;
  let m;
  while ((m = hidden.exec(out))) {
    const start = m.index;
    const end = endOfElement(out, start, m[1]);
    if (end < 0) break;
    const container = out.slice(start, end);
    const seg = /<(\w+)\b[^>]*\bid="S:([0-9a-f]+)"[^>]*>/g;
    let sm;
    while ((sm = seg.exec(container))) {
      const innerStart = sm.index + sm[0].length;
      const innerEnd = endOfElement(container, sm.index, sm[1]) - (`</${sm[1]}>`).length;
      segs.set(sm[2], container.slice(innerStart, innerEnd));
    }
    out = out.slice(0, start) + out.slice(end);
    hidden.lastIndex = start;
  }
  // Second pass: segments whose container carries the id itself and is hidden
  // by style, not by attribute (<svg aria-hidden="true" style="display:none"
  // id="S:n"> for icon paths).
  const direct = /<(\w+)\b[^>]*\bid="S:([0-9a-f]+)"[^>]*>/g;
  while ((m = direct.exec(out))) {
    const start = m.index;
    const end = endOfElement(out, start, m[1]);
    if (end < 0) break;
    segs.set(m[2], out.slice(start + m[0].length, end - (`</${m[1]}>`).length));
    out = out.slice(0, start) + out.slice(end);
    direct.lastIndex = start;
  }
  // Segment ids are hex (P:a, P:10). Segments can nest; keep substituting until nothing changes.
  for (let pass = 0; pass < 10; pass++) {
    const before = out;
    out = out.replace(/<template id="P:([0-9a-f]+)"><\/template>/g, (whole, n) => segs.get(n) ?? whole);
    out = out.replace(/<!--\$\?--><template id="B:([0-9a-f]+)"><\/template>[\s\S]*?<!--\/\$-->/g, (whole, n) => (segs.has(n) ? segs.get(n) : whole));
    if (out === before) break;
  }
  return out.replace(/<!--\$[?!]?-->|<!--\/\$-->/g, "");
}

function normalize(html) {
  return resolveStreaming(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
    // React useId tokens (_R_a6lubsnmpfdb_, used by Radix for aria-controls /
    // id pairs) encode the component's POSITION in the tree, so moving markup
    // into a child component changes them while the DOM is otherwise the
    // same. Masked; the pairing itself still has to match on both sides.
    .replace(/_R_[A-Za-z0-9]+_/g, "_R_ID_")
    // Server-action hidden inputs carry a per-request encryption nonce.
    .replace(/(name="\$ACTION_[^"]*" value=")[^"]*(")/g, "$1ACTION$2")
    .replace(/\/_next\/static\/[^/"']+\//g, "/_next/static/HASH/")
    .replace(/-[a-f0-9]{16}\.(js|css)/g, "-HASH.$1")
    .replace(/commit\/[a-f0-9]{7,40}/g, "commit/SHA")
    .replace(/>[a-f0-9]{7}</g, ">SHA<")
    .replace(/Server time [^<]+/g, "Server time TIME");
}

class Jar {
  constructor() { this.c = new Map(); }
  take(res) { for (const line of res.headers.getSetCookie?.() ?? []) { const [kv] = line.split(";"); const [k, v] = kv.split("="); this.c.set(k.trim(), v); } }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function login(email) {
  const jar = new Jar();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`); jar.take(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const body = new URLSearchParams({ csrfToken, email, password: "Passw0rd!demo", callbackUrl: `${BASE}/` });
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", body, redirect: "manual", headers: { cookie: jar.header(), "content-type": "application/x-www-form-urlencoded" } });
  jar.take(res);
  if (![302, 303, 200].includes(res.status)) throw new Error(`login ${email}: HTTP ${res.status}`);
  return jar;
}
async function get(jar, path, rawFile) {
  const res = await fetch(BASE + path, { headers: { cookie: jar.header() }, redirect: "manual" });
  if (res.status !== 200) throw new Error(`${path}: HTTP ${res.status}`);
  const raw = await res.text();
  // GOLDEN_RAW=1 keeps the un-normalized stream next to the golden (debugging
  // the normalizer); .raw.html is git-ignored.
  if (process.env.GOLDEN_RAW && rawFile) { mkdirSync(dirname(rawFile), { recursive: true }); writeFileSync(rawFile, raw); }
  return normalize(raw);
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    if (serverExit !== null) throw new Error(`golden: the server exited (code ${serverExit}) before becoming healthy; run "npx next build" first?`);
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server never became healthy");
}

// Refuse to run if something already owns the port. Otherwise our server dies
// with EADDRINUSE, the health probe is answered by the squatter, and the
// comparison silently runs against code that is not the current build.
const portTaken = await new Promise((resolve) => {
  const sock = net.connect({ port: 3111, host: "127.0.0.1" });
  sock.once("connect", () => { sock.destroy(); resolve(true); });
  sock.once("error", () => resolve(false));
});
if (portTaken) {
  console.error("golden: port 3111 is already in use; stop whatever is listening there and re-run.");
  process.exit(2);
}

// The next binary directly, not via npx: SIGTERM then reaches the server
// itself instead of a wrapper that may leave it running.
let serverExit = null;
const server = spawn(process.execPath, [join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", "3111"], {
  cwd: ROOT, stdio: ["ignore", "ignore", "inherit"],
  env: { ...process.env, TZ: "UTC", GOLDEN_NOW, NODE_OPTIONS: `--require ${join(ROOT, "scripts/golden/fixed-clock.cjs")}` },
});
server.once("exit", (code) => { serverExit = code ?? 1; });
let failures = 0;
try {
  await waitHealthy();
  const jars = { owner: await login("owner@example.com"), employee: await login("marcus@example.com") };
  for (const [role, label, path] of ROUTES) {
    const file = join(OUT, role, `${label}.html`);
    const html = await get(jars[role], path, join(OUT, role, `${label}.raw.html`));
    mkdirSync(dirname(file), { recursive: true });
    if (mode === "record") { writeFileSync(file, html); console.log(`recorded ${role}/${label}`); continue; }
    if (!existsSync(file)) { console.log(`MISSING ${role}/${label}`); failures++; continue; }
    const want = readFileSync(file, "utf8");
    if (want === html) { console.log(`same     ${role}/${label}`); continue; }
    failures++;
    const tmp = join(OUT, role, `${label}.actual.html`); writeFileSync(tmp, html);
    console.log(`DIFF     ${role}/${label}`);
    try { execSync(`diff -u "${file}" "${tmp}" | head -40`, { stdio: "inherit" }); } catch {}
  }
} finally {
  server.kill("SIGTERM");
}
if (mode === "check") { console.log(failures ? `\n${failures} ROUTE(S) DIFFER` : "\nALL GOLDENS IDENTICAL"); process.exit(failures ? 1 : 0); }
