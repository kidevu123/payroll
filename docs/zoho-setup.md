# Zoho Books integration

The Reports table's "Push to Haute" / "Push to Boomin" buttons post a Zoho
Books expense for the run's total. Each company you push to is a row in
`zoho_organizations`. OAuth refresh tokens (and client_id / client_secret)
are sealed via the same AES-GCM vault as NGTeco credentials.

## One-time Zoho-side setup (per company)

1. Sign in to <https://api-console.zoho.com/> with the company's Zoho admin
   account.
2. Add a new client of type **Server-based Applications**.
3. Set:
   - Client name: `Payroll integration` (or anything memorable)
   - Homepage URL: your payroll URL, e.g. `https://digitz.duckdns.org`
   - Authorized Redirect URIs: `https://digitz.duckdns.org/api/zoho/oauth/callback`
4. Save. Copy the **Client ID** and **Client Secret** — you'll paste these
   into the payroll Settings tab.
5. In Zoho Books → Settings → Manage Subscription, copy the numeric
   **organization_id** (visible at the top of the page).

## In the payroll app

1. Sign in as an admin and go to **Settings → Zoho**.
2. Click **Add organization**.
   - Display name: `Haute` (or `Boomin`)
   - organization_id: the numeric id from Zoho
   - API domain: `https://www.zohoapis.com` (default; use `.eu`, `.in`, etc
     for non-US tenants)
   - Accounts domain: `https://accounts.zoho.com` (matches the API domain)
   - Client ID + Client Secret: from step 4 above
   - Default expense account name: e.g. `Salaries Payable`
   - Default paid-through account name: e.g. `Operating Account`
3. Save. The org appears as **Not connected**.
4. Click **Connect Haute** (or **Connect Boomin**). You'll bounce through
   Zoho's auth screen, accept the scopes, and land back in the payroll
   tab. The chip flips to **Connected**.
5. Click **Test** to verify. A green status line confirms the refresh
   token was accepted and the API is reachable.

## Pushing a report

From `/reports`, every row gets per-org **Push** pills. Click **Push to
Haute** to create the expense. On success the pill flips to a green
"Pushed" chip with the Zoho expense id; the row is also recorded in
`zoho_pushes` so re-pressing the button is a no-op (idempotent via the
unique index on `(payroll_run_id, organization_id) WHERE status='OK'`).

## Troubleshooting

- **token_exchange_failed**: the redirect URI on Zoho's console does not
  match the URL the app sees. Check `APP_URL` in `/etc/payroll/.env` and
  the redirect URI in the Zoho self-client.
- **No Zoho expense account configured**: fill in the
  *Default expense account name* in the org form. The push step looks the
  account up by name on each push.
- **Push pill never flips**: check `audit_log` for `zoho.push.error` rows;
  the full error message lives on the matching `zoho_pushes` row.
