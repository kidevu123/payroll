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
  const token = await getAccessToken(org);
  const url = `${org.apiDomain}/books/v3${path}${path.includes("?") ? "&" : "?"}organization_id=${org.organizationId}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Zoho-oauthtoken ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers });
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

async function resolveAccountId(
  org: ZohoOrganization,
  hint: { id?: string | null; name?: string | null },
): Promise<string | null> {
  if (hint.id) return hint.id;
  if (!hint.name) return null;
  const resp = await authedFetch(
    org,
    `/chartofaccounts?account_name=${encodeURIComponent(hint.name)}`,
  );
  if (!resp.ok) return null;
  const json = (await resp.json()) as {
    chartofaccounts?: Array<{ account_id: string; account_name: string }>;
  };
  return json.chartofaccounts?.[0]?.account_id ?? null;
}

export type CreateExpenseInput = {
  org: ZohoOrganization;
  amountCents: number;
  reference: string;
  date: string; // YYYY-MM-DD
};

export type CreateExpenseResult = {
  expenseId: string;
};

export async function createExpense(
  input: CreateExpenseInput,
): Promise<CreateExpenseResult> {
  const { org, amountCents, reference, date } = input;
  const accountId = await resolveAccountId(org, {
    id: org.defaultExpenseAccountId,
    name: org.defaultExpenseAccountName,
  });
  if (!accountId) {
    throw new Error(
      `No Zoho expense account configured for ${org.name}. Set defaultExpenseAccountName in /settings/zoho.`,
    );
  }
  const paidThroughId = await resolveAccountId(org, {
    id: org.defaultPaidThroughId,
    name: org.defaultPaidThroughName,
  });
  if (!paidThroughId) {
    throw new Error(
      `No Zoho paid-through account configured for ${org.name}.`,
    );
  }
  const body: Record<string, unknown> = {
    account_id: accountId,
    paid_through_account_id: paidThroughId,
    date,
    amount: amountCents / 100,
    reference_number: reference.slice(0, 100),
    description: `Payroll run pushed from /reports — ${reference}`,
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
  const json = (await resp.json()) as { expense?: { expense_id: string } };
  if (!json.expense?.expense_id) {
    throw new Error("Zoho expense create: no expense_id in response.");
  }
  return { expenseId: json.expense.expense_id };
}
