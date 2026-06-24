// Browserless NGTeco client.
//
// Replaces the headless-browser screen-scrape with direct calls to NGTeco's
// REST API (office-api.ngteco.com), discovered via the MILO_CAPTURE_API probe.
// The portal at office.ngteco.com is a Vue SPA that fetches punch data as JSON
// from this API and renders a table; scraping that rendered table is the slow,
// timeout-prone path that breaks weekly. Calling the API directly is fast and
// reliable: no Chromium, no DOM, no pagination-scroll, no 10-minute timeout.
//
//   POST /oauth2/api/v1.0/token
//        body { username, password, verify_code:"", verify:false }
//        → { data: { access, refresh, expired_at, user_id } }
//   GET  /att/api/v1.0/transactions/transaction/
//        ?current=<page>&pageSize=<n>&keyword=&date_range=<start>&date_range=<end>
//        Authorization: Bearer <access>
//        → { data: { total, num_pages, page, page_size, data: [ ...records ] } }
//
// Each record maps 1:1 to a RawPunchEvent — the same shape the scraper emits —
// so the entire downstream pairing / dedupe / import pipeline is unchanged.

import type { RawPunchEvent } from "./scraper";

/** Derive the API host from the configured portal URL. The SPA lives at
 *  office.ngteco.com; its backend API is office-api.ngteco.com. */
export function ngtecoApiBase(portalUrl: string): string {
  try {
    const u = new URL(portalUrl);
    const host = u.hostname.replace(/^office\./i, "office-api.");
    return `${u.protocol}//${host}`;
  } catch {
    return "https://office-api.ngteco.com";
  }
}

export class NgtecoApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "NgtecoApiError";
  }
}

type LoginResult = { access: string; refresh: string | null };

export async function ngtecoApiLogin(
  portalUrl: string,
  username: string,
  password: string,
): Promise<LoginResult> {
  const base = ngtecoApiBase(portalUrl);
  const resp = await fetch(`${base}/oauth2/api/v1.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password, verify_code: "", verify: false }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new NgtecoApiError(
      `NGTeco login failed: ${resp.status} ${text.slice(0, 200)}`,
      resp.status,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new NgtecoApiError("NGTeco login: response was not JSON.");
  }
  const data = (json as { data?: { access?: string; refresh?: string } }).data;
  if (!data?.access) {
    throw new NgtecoApiError("NGTeco login: no access token in response.");
  }
  return { access: data.access, refresh: data.refresh ?? null };
}

type TransactionRecord = {
  employee_code?: string;
  employee_name?: string;
  first_name?: string;
  last_name?: string;
  att_date?: string;
  timezone?: string;
  punch_from?: string;
  verify_type?: string;
  id?: string;
  punch_format_time?: string;
};

/**
 * Build an ISO-8601 instant (with offset) from the API's date/time/tz fields.
 * Defensive about formats since the capture only revealed types, not values:
 *   att_date: "2026-06-24" or "06/24/2026"
 *   punch_format_time: "17:15:02" or "17:15" or "2026-06-24 17:15:02"
 *   timezone: "-04:00" or "-0400" or "UTC-4"
 */
export function buildPunchIso(
  attDate: string,
  punchTime: string,
  tz: string,
): string | null {
  let date = (attDate || "").trim();
  let time = (punchTime || "").trim();

  // punch_format_time sometimes carries the full "YYYY-MM-DD HH:mm:ss".
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(time)) {
    const [d, t] = time.split(/[ T]/);
    if (d) date = d;
    if (t) time = t;
  }

  // Normalize date → YYYY-MM-DD.
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
    const [mm, dd, yyyy] = date.split("/");
    date = `${yyyy}-${mm}-${dd}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  // Normalize time → HH:mm:ss.
  if (/^\d{1,2}:\d{2}$/.test(time)) time = `${time}:00`;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(time)) {
    const [h, m, s] = time.split(":");
    time = `${h!.padStart(2, "0")}:${m}:${s}`;
  } else {
    return null;
  }

  // Normalize offset → ±HH:mm.
  let offset = (tz || "").trim();
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (m) {
    offset = `${m[1]}${m[2]}:${m[3]}`;
  } else {
    // Unknown/empty tz: fall back to "Z" would be wrong (these are wall-clock
    // device times). Leave offset out and let the caller's tz handling apply —
    // but the scraper always had an offset, so default to no-offset ISO which
    // the importer interprets in the company tz.
    offset = "";
  }

  const iso = `${date}T${time}${offset}`;
  // Validate it parses.
  if (Number.isNaN(Date.parse(offset ? iso : `${iso}Z`))) return null;
  return iso;
}

function mapRecord(r: TransactionRecord): RawPunchEvent | null {
  const personId = String(r.employee_code ?? "").trim();
  if (!personId) return null;
  const rawDate = String(r.att_date ?? "").trim();
  const rawTime = String(r.punch_format_time ?? "").trim();
  const rawTz = String(r.timezone ?? "").trim();
  const punchAt = buildPunchIso(rawDate, rawTime, rawTz);
  if (!punchAt) return null;
  const personName =
    String(r.employee_name ?? "").trim() ||
    `${(r.first_name ?? "").trim()} ${(r.last_name ?? "").trim()}`.trim();
  return {
    personId,
    personName,
    punchAt,
    rawDate,
    rawTime,
    rawTz,
    verifyType: String(r.verify_type ?? "").trim(),
    source: String(r.punch_from ?? "").trim(),
  };
}

export type FetchTransactionsResult = {
  events: RawPunchEvent[];
  /** Raw field names + a single sample (for one-time format verification). */
  sampleRecordKeys: string[];
  total: number;
  unparsed: number;
};

export async function fetchNgtecoTransactions(
  portalUrl: string,
  accessToken: string,
  opts: { startDate: string; endDate: string; pageSize?: number; maxRecords?: number },
): Promise<FetchTransactionsResult> {
  const { startDate, endDate, pageSize = 500, maxRecords = 50_000 } = opts;
  const base = ngtecoApiBase(portalUrl);
  const events: RawPunchEvent[] = [];
  let page = 1;
  let numPages = 1;
  let total = 0;
  let unparsed = 0;
  let sampleRecordKeys: string[] = [];

  do {
    const url = new URL(`${base}/att/api/v1.0/transactions/transaction/`);
    url.searchParams.set("current", String(page));
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("keyword", "");
    url.searchParams.append("date_range", startDate);
    url.searchParams.append("date_range", endDate);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new NgtecoApiError(
        `NGTeco transactions failed (page ${page}): ${resp.status} ${text.slice(0, 200)}`,
        resp.status,
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new NgtecoApiError("NGTeco transactions: response was not JSON.");
    }
    const data = (json as { data?: { num_pages?: number; total?: number; data?: TransactionRecord[] } }).data;
    numPages = data?.num_pages ?? 1;
    total = data?.total ?? total;
    const rows = data?.data ?? [];
    if (page === 1 && rows.length > 0 && rows[0]) {
      sampleRecordKeys = Object.keys(rows[0]);
    }
    for (const r of rows) {
      const ev = mapRecord(r);
      if (ev) events.push(ev);
      else unparsed++;
    }
    page++;
  } while (page <= numPages && events.length < maxRecords);

  return { events, sampleRecordKeys, total, unparsed };
}
