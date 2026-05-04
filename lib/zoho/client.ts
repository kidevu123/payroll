// Zoho Books REST client. Ported from the legacy Flask app's
// (simple_app.py lines 220-500+) but reshaped:
//   - Per-org credentials live in zoho_organizations (encrypted refresh
//     token + client_id + client_secret via lib/crypto/vault.ts).
//   - Token cache is per-process (org id → { token, expiresAt }).
//   - Network code is fetch-based; the legacy app used `requests`.
//
// Public surface:
//   - validateConnection(org)  → { ok, message }
//   - createExpense({ org, amountCents, reference, date })
//
// All other Zoho behavior (account / vendor / paid-through lookup) is
// folded into createExpense to keep the API surface tight.

import { open as openSealed } from "@/lib/crypto/vault";
import type { ZohoOrganization } from "@/lib/db/schema";

type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

function isEnvelope(value: unknown): value is { ciphertext: string; iv: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ciphertext" in value &&
    "iv" in value
  );
}

async function decryptOrgSecrets(org: ZohoOrganization): Promise<{
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}> {
  if (
    !isEnvelope(org.refreshTokenEncrypted) ||
    !isEnvelope(org.clientIdEncrypted) ||
    !isEnvelope(org.clientSecretEncrypted)
  ) {
    throw new Error(
      `Zoho org "${org.name}" is missing OAuth credentials — connect it from /settings/zoho.`,
    );
  }
  return {
    refreshToken: openSealed(org.refreshTokenEncrypted),
    clientId: openSealed(org.clientIdEncrypted),
    clientSecret: openSealed(org.clientSecretEncrypted),
  };
}

async function getAccessToken(org: ZohoOrganization): Promise<string> {
  const cached = tokenCache.get(org.id);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 30_000) {
    return cached.accessToken;
  }
  const { refreshToken, clientId, clientSecret } = await decryptOrgSecrets(org);
  const url = `${org.accountsDomain}/oauth/v2/token`;
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoho token refresh failed: ${resp.status} ${text}`);
  }
  const json = (await resp.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!json.access_token) {
    throw new Error(`Zoho token refresh: ${json.error ?? "no access_token"}`);
  }
  const ttlMs = (json.expires_in ?? 3600) * 1000;
  tokenCache.set(org.id, {
    accessToken: json.access_token,
    expiresAt: now + ttlMs,
  });
  return json.access_token;
}

async function authedFetch(
  org: ZohoOrganization,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${org.apiDomain}/books/v3${path}${path.includes("?") ? "&" : "?"}organization_id=${org.organizationId}`;
  const doFetch = async (token: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Zoho-oauthtoken ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(url, { ...init, headers });
  };
  // First attempt with cached/refreshed token.
  let token = await getAccessToken(org);
  let resp = await doFetch(token);
  // If Zoho rejects the token (401 / 403 invalid_token), evict the cache
  // and retry once with a fresh token. Without this, a single revoked
  // token poisons all subsequent calls until the process restarts.
  if (resp.status === 401) {
    tokenCache.delete(org.id);
    token = await getAccessToken(org);
    resp = await doFetch(token);
  }
  return resp;
}

export async function validateConnection(
  org: ZohoOrganization,
): Promise<{ ok: boolean; message: string }> {
  try {
    const resp = await authedFetch(org, `/organizations/${org.organizationId}`);
    if (resp.ok) return { ok: true, message: "Connection OK." };
    const text = await resp.text();
    return { ok: false, message: `${resp.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

type ZohoAccountRow = {
  account_id: string;
  account_name: string;
  account_code?: string | null;
  is_active?: boolean;
  status?: string;
};

/**
 * Fetch every chart-of-accounts row, walking page_context.has_more_page.
 * Zoho's per_page maxes at 200, so an org with hundreds of accounts will
 * silently miss matches if you don't paginate.
 *
 * Returns both the rows and a `lastError` field — when present, the
 * resolver surfaces it in the user-facing error so a failed lookup says
 * exactly why (auth issue, 400 on filter, etc.) rather than the bland
 * "not found" we showed before.
 */
type FetchAccountsResult = {
  rows: ZohoAccountRow[];
  lastError: string | null;
};

async function fetchAllAccounts(
  org: ZohoOrganization,
  searchText?: string,
): Promise<FetchAccountsResult> {
  const all: ZohoAccountRow[] = [];
  let lastError: string | null = null;
  let page = 1;
  // 20 pages * 200 = 4000 accounts — far past anything realistic.
  for (let i = 0; i < 20; i++) {
    // Mirror the legacy app's URL: filter_by=AccountType.All + search_text
    // for server-side filtering. search_text is a wildcard contains-match
    // on Zoho's side, which collapses the list dramatically before we
    // paginate. Both params are tolerated by Zoho even on minimal scopes.
    const params = new URLSearchParams({
      per_page: "200",
      page: String(page),
      filter_by: "AccountType.All",
    });
    if (searchText) params.set("search_text", searchText);
    const resp = await authedFetch(org, `/chartofaccounts?${params.toString()}`);
    if (!resp.ok) {
      const text = await resp.text();
      lastError = `${resp.status}: ${text.slice(0, 200)}`;
      break;
    }
    const json = (await resp.json()) as {
      chartofaccounts?: ZohoAccountRow[];
      page_context?: { has_more_page?: boolean; page?: number };
    };
    const rows = json.chartofaccounts ?? [];
    all.push(...rows);
    if (!json.page_context?.has_more_page) break;
    page += 1;
  }
  return { rows: all, lastError };
}

const ZOHO_DESCRIPTION_MAX = 500;
const ZOHO_DESCRIPTION_SUFFIX = " … (see attachment)";

/**
 * Hard-cap an expense description at Zoho's 500-character limit. Mirrors
 * the legacy Flask app: when the source is too long, truncate to fit
 * "… (see attachment)" at the end so the receipt PDF — which carries
 * the full per-employee summary — has an obvious pointer.
 */
function capDescription(text: string): string {
  if (text.length <= ZOHO_DESCRIPTION_MAX) return text;
  const cutoff = ZOHO_DESCRIPTION_MAX - ZOHO_DESCRIPTION_SUFFIX.length;
  return text.slice(0, cutoff).replace(/\s+$/, "") + ZOHO_DESCRIPTION_SUFFIX;
}

function normalizeAccountName(s: string): string {
  // Strip a leading "[CODE] " prefix that Zoho's UI shows but the API
  // sometimes returns embedded in account_name on older orgs. Lowercase
  // and collapse whitespace for tolerant compare.
  return s
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function resolveAccountId(
  org: ZohoOrganization,
  hint: { id?: string | null; name?: string | null },
): Promise<{ id: string | null; tried: string[]; apiError: string | null }> {
  if (hint.id) return { id: hint.id, tried: [hint.id], apiError: null };
  if (!hint.name) return { id: null, tried: [], apiError: null };

  // Strip "[CODE] " from the search text so Zoho's server-side filter
  // matches against the raw account name.
  const searchText = hint.name.replace(/^\s*\[[^\]]+\]\s*/, "").trim();
  const fetched = await fetchAllAccounts(org, searchText);
  const accounts = fetched.rows;
  const target = normalizeAccountName(hint.name);
  // 1) Exact match on normalized name.
  const exact = accounts.find(
    (a) => normalizeAccountName(a.account_name) === target,
  );
  if (exact) return { id: exact.account_id, tried: [hint.name], apiError: null };
  // 2) Match on account_code (e.g. "5300" matches "[5300] Payroll Expenses").
  const byCode = accounts.find(
    (a) =>
      (a.account_code ?? "").trim().toLowerCase() === hint.name!.trim().toLowerCase(),
  );
  if (byCode)
    return { id: byCode.account_id, tried: [hint.name, "by code"], apiError: null };
  // 3) Contains-match on the normalized name (e.g. "payroll" → "payroll expenses").
  const partial = accounts.find((a) =>
    normalizeAccountName(a.account_name).includes(target),
  );
  if (partial)
    return { id: partial.account_id, tried: [hint.name, "partial"], apiError: null };

  // No match — return a sample of available names so the caller can
  // surface a diagnosable error. Sort by code so the sample is stable
  // and easy to scan.
  const sample = [...accounts]
    .sort((a, b) =>
      (a.account_code ?? "zzz").localeCompare(b.account_code ?? "zzz"),
    )
    .slice(0, 40)
    .map((a) => `[${a.account_code ?? "—"}] ${a.account_name}`);
  return { id: null, tried: sample, apiError: fetched.lastError };
}

export type CreateExpenseInput = {
  org: ZohoOrganization;
  amountCents: number;
  reference: string;
  date: string; // YYYY-MM-DD
  /**
   * Free-form text written into Zoho's expense `description` (Notes) field.
   * If omitted, falls back to the legacy "Payroll run pushed from /reports — <ref>"
   * line. Zoho silently truncates very long descriptions; we cap at 5000 chars
   * to stay safely under their per-field limit.
   */
  description?: string;
};

export type CreateExpenseResult = {
  expenseId: string;
};

export async function createExpense(
  input: CreateExpenseInput,
): Promise<CreateExpenseResult> {
  const { org, amountCents, reference, date, description } = input;
  const expense = await resolveAccountId(org, {
    id: org.defaultExpenseAccountId,
    name: org.defaultExpenseAccountName,
  });
  if (!expense.id) {
    const apiHint = expense.apiError
      ? ` Zoho /chartofaccounts call failed: ${expense.apiError}.`
      : "";
    const sample = expense.tried.length
      ? ` Available accounts: ${expense.tried.join(" · ")}.`
      : " (No accounts returned from Zoho.)";
    throw new Error(
      `Zoho expense account "${org.defaultExpenseAccountName ?? "(unset)"}" not found in ${org.name}.${apiHint} Open /settings/zoho → Edit and pick a name that matches one of your Zoho Books chart-of-accounts entries (case insensitive, brackets/codes ignored).${sample}`,
    );
  }
  const paidThrough = await resolveAccountId(org, {
    id: org.defaultPaidThroughId,
    name: org.defaultPaidThroughName,
  });
  if (!paidThrough.id) {
    const apiHint = paidThrough.apiError
      ? ` Zoho /chartofaccounts call failed: ${paidThrough.apiError}.`
      : "";
    const sample = paidThrough.tried.length
      ? ` Available accounts: ${paidThrough.tried.join(" · ")}.`
      : " (No accounts returned from Zoho.)";
    throw new Error(
      `Zoho paid-through account "${org.defaultPaidThroughName ?? "(unset)"}" not found in ${org.name}.${apiHint}${sample}`,
    );
  }
  const body: Record<string, unknown> = {
    account_id: expense.id,
    paid_through_account_id: paidThrough.id,
    date,
    amount: amountCents / 100,
    reference_number: reference.slice(0, 100),
    // Zoho enforces a 500-char limit on the expense description (code 15
    // on overflow). The legacy app truncated mid-summary with a "… (see
    // attachment)" hint pointing at the receipt PDF, which is what we do
    // here too — the full per-employee table is still in the PDF, the
    // description just gets the lead lines.
    description: capDescription(
      description ?? `Payroll run pushed from /reports — ${reference}`,
    ),
  };
  if (org.defaultVendorId) body.vendor_id = org.defaultVendorId;
  const resp = await authedFetch(org, "/expenses", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Zoho expense create failed: ${resp.status} ${text.slice(0, 300)}`);
  }
  // Zoho wraps every response in { code, message, expense? }. Even on
  // HTTP 200 a non-zero code indicates a soft failure (bad vendor, bad
  // paid_through, etc.) — treat it as an error and surface Zoho's own
  // message instead of a generic "no expense_id" miss.
  const json = (await resp.json()) as {
    code?: number;
    message?: string;
    expense?: { expense_id: string };
  };
  if (typeof json.code === "number" && json.code !== 0) {
    throw new Error(
      `Zoho expense create failed (code ${json.code}): ${json.message ?? "no message"}`,
    );
  }
  if (!json.expense?.expense_id) {
    throw new Error(
      `Zoho expense create: no expense_id in response (message: ${json.message ?? "—"})`,
    );
  }
  return { expenseId: json.expense.expense_id };
}

/**
 * Delete an expense in Zoho Books. Returns true on success or 404 (the
 * expense was already gone — counts as deleted for our purposes).
 * Throws on other errors so the caller can surface them.
 */
export async function deleteExpense(
  org: ZohoOrganization,
  expenseId: string,
): Promise<{ ok: boolean; alreadyGone: boolean; message?: string }> {
  const resp = await authedFetch(org, `/expenses/${encodeURIComponent(expenseId)}`, {
    method: "DELETE",
  });
  if (resp.ok) return { ok: true, alreadyGone: false };
  if (resp.status === 404) return { ok: true, alreadyGone: true };
  const text = await resp.text();
  return {
    ok: false,
    alreadyGone: false,
    message: `${resp.status}: ${text.slice(0, 200)}`,
  };
}

/**
 * Attach a file (paystub PDF, scanned receipt, etc.) to an existing
 * Zoho expense as its receipt. Uses multipart/form-data per the Zoho
 * Books API docs (POST /expenses/{id}/receipt).
 *
 * `bytes` must already be in memory; we wrap it in a Blob to satisfy
 * the FormData type without piping through a temp file.
 */
export async function attachReceipt(input: {
  org: ZohoOrganization;
  expenseId: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<void> {
  const { org, expenseId, filename, mime, bytes } = input;
  const token = await getAccessToken(org);
  const url = `${org.apiDomain}/books/v3/expenses/${encodeURIComponent(expenseId)}/receipt?organization_id=${org.organizationId}`;
  const form = new FormData();
  form.set("receipt", new Blob([bytes as BlobPart], { type: mime }), filename);
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Zoho expense receipt attach failed: ${resp.status} ${text.slice(0, 300)}`,
    );
  }
}
