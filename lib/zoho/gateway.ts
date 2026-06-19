// Route Zoho Books expense calls through the central Zoho Integration
// Service (the FastAPI gateway on LXC 9503) instead of calling Zoho cloud
// directly.
//
// Why: the gateway holds the OAuth tokens (ZohoBooks.fullaccess.all) and
// per-brand chart-of-accounts config, centralizes rate-limiting + audit, and
// — critically — can DELETE expenses (Milo's own per-org token was minted
// without expenses.DELETE, which broke the re-push flow). With the gateway,
// Milo just sends the expense body + an X-Brand header; the gateway injects
// account_id/paid_through from the brand config and forwards to Zoho.
//
// Enabled when BOTH env vars are set (so local dev without the gateway falls
// back to the direct path in client.ts):
//   ZOHO_GATEWAY_URL    e.g. http://192.168.1.205:8000
//   ZOHO_GATEWAY_TOKEN  the gateway's INTERNAL_API_TOKEN (a shared secret;
//                       lives in /etc/payroll/.env, never committed)

import type { ZohoOrganization } from "@/lib/db/schema";

export function gatewayConfigured(): boolean {
  return Boolean(process.env.ZOHO_GATEWAY_URL && process.env.ZOHO_GATEWAY_TOKEN);
}

// Milo Zoho org → gateway brand slug. Explicit so a new/renamed org can't
// silently push to the wrong brand; falls back to "<name>_brands" (the
// gateway's convention) only as a last resort.
const BRAND_BY_ORG_NAME: Record<string, string> = {
  boomin: "boomin_brands",
  haute: "haute_brands",
};

export function gatewayBrandFor(org: Pick<ZohoOrganization, "name">): string {
  const key = org.name.trim().toLowerCase();
  return BRAND_BY_ORG_NAME[key] ?? `${key.replace(/\s+/g, "_")}_brands`;
}

function gatewayUrl(path: string): string {
  const base = (process.env.ZOHO_GATEWAY_URL ?? "").replace(/\/+$/, "");
  return `${base}${path}`;
}

function gatewayHeaders(
  org: Pick<ZohoOrganization, "name">,
  extra?: Record<string, string>,
): Headers {
  const headers = new Headers(extra);
  headers.set("X-Brand", gatewayBrandFor(org));
  headers.set("X-Internal-Token", process.env.ZOHO_GATEWAY_TOKEN ?? "");
  return headers;
}

type GatewayJson = {
  code?: number;
  message?: string;
  expense?: { expense_id?: string };
  data?: { expense?: { expense_id?: string } };
  detail?: { error?: { message?: string } };
};

function parse(text: string): GatewayJson {
  try {
    return JSON.parse(text) as GatewayJson;
  } catch {
    return {};
  }
}

export async function gatewayCreateExpense(input: {
  org: ZohoOrganization;
  amountCents: number;
  reference: string;
  date: string;
  description?: string;
}): Promise<{ expenseId: string }> {
  const { org, amountCents, reference, date, description } = input;
  // account_id / paid_through_account_id are injected by the gateway from the
  // brand's config, so we deliberately omit them here.
  const body: Record<string, unknown> = {
    date,
    amount: amountCents / 100,
    reference_number: reference.slice(0, 100),
    description: (description ?? `Paystub — ${reference}`).slice(0, 500),
  };
  // Send the org's configured account IDs when present. The gateway overrides
  // these with the brand's own config where it has one (e.g. expense account),
  // and falls back to ours where it doesn't (e.g. a brand missing paid-through).
  if (org.defaultExpenseAccountId) body.account_id = org.defaultExpenseAccountId;
  if (org.defaultPaidThroughId) {
    body.paid_through_account_id = org.defaultPaidThroughId;
  }
  if (org.defaultVendorId) body.vendor_id = org.defaultVendorId;

  const resp = await fetch(gatewayUrl("/zoho/expenses/create_books"), {
    method: "POST",
    headers: gatewayHeaders(org, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  const json = parse(text);
  if (!resp.ok) {
    const msg = json.detail?.error?.message ?? text.slice(0, 300);
    throw new Error(`Zoho gateway expense create failed: ${resp.status} ${msg}`);
  }
  if (typeof json.code === "number" && json.code !== 0) {
    throw new Error(
      `Zoho expense create failed (code ${json.code}): ${json.message ?? "no message"}`,
    );
  }
  const expenseId =
    json.expense?.expense_id ?? json.data?.expense?.expense_id ?? null;
  if (!expenseId) {
    throw new Error(
      `Zoho gateway expense create: no expense_id in response (${text.slice(0, 200)})`,
    );
  }
  return { expenseId };
}

export async function gatewayDeleteExpense(
  org: ZohoOrganization,
  expenseId: string,
): Promise<{ ok: boolean; alreadyGone: boolean; message?: string }> {
  const resp = await fetch(
    gatewayUrl(`/zoho/expenses/delete_books/${encodeURIComponent(expenseId)}`),
    { method: "DELETE", headers: gatewayHeaders(org) },
  );
  if (resp.ok) return { ok: true, alreadyGone: false };
  if (resp.status === 404) return { ok: true, alreadyGone: true };
  const text = await resp.text();
  const json = parse(text);
  const msg = json.detail?.error?.message ?? text.slice(0, 200);
  return { ok: false, alreadyGone: false, message: `${resp.status}: ${msg}` };
}

export async function gatewayAttachReceipt(input: {
  org: ZohoOrganization;
  expenseId: string;
  filename: string;
  mime: string;
  bytes: Uint8Array;
}): Promise<void> {
  const { org, expenseId, filename, mime, bytes } = input;
  const form = new FormData();
  // Gateway field name is "attachment" (it maps to Zoho's "receipt").
  form.set("attachment", new Blob([bytes as BlobPart], { type: mime }), filename);
  const resp = await fetch(
    gatewayUrl(`/zoho/expenses/attach_receipt/${encodeURIComponent(expenseId)}`),
    {
      method: "POST",
      // No Content-Type — FormData sets the multipart boundary itself.
      headers: gatewayHeaders(org),
      body: form,
    },
  );
  if (!resp.ok) {
    const text = await resp.text();
    const json = parse(text);
    const msg = json.detail?.error?.message ?? text.slice(0, 300);
    throw new Error(`Zoho gateway receipt attach failed: ${resp.status} ${msg}`);
  }
}
