# Golden DOM pins

`tests/golden/` holds the server-rendered DOM of the time, reports, period and
employee pages, fetched from the BUILT app running against the local scratch
database under a frozen clock. They are the regression test for the
giant-files refactor (docs/superpowers/specs/2026-10-07-giant-files-split-design.md):
after any change to those pages, `npm run golden:check` must print
`ALL GOLDENS IDENTICAL`. A golden changes only by an explicit decision; then
`npm run golden:record` rewrites it and the diff is reviewed and committed.

## One-time setup

1. The scratch database `payroll_mobile_ui` (created during the mobile pass):
   24 demo employees, logins `owner@example.com` / `marcus@example.com`,
   password `Passw0rd!demo`. See CLAUDE.md for how it was built (replay
   `drizzle/*.sql` one file at a time, then `scripts/seed-demo.ts`).
2. `.env.golden.local` in the repo root (git-ignored; throwaway secrets):

```
DATABASE_URL=postgresql://localhost:5432/payroll_mobile_ui
AUTH_SECRET=golden-only-secret-golden-only-secret-golden-only
NGTECO_VAULT_KEY=Z29sZGVuLW9ubHktdmF1bHQta2V5LTMyLWJ5dGVzISE=
APP_URL=http://localhost:3111
AUTH_URL=http://localhost:3111
AUTH_TRUST_HOST=true
STORAGE_ROOT=/tmp/payroll-golden-storage
PAYSLIP_STORAGE_DIR=/tmp/payroll-golden-storage/payslips
PAYROLL_DOC_ROOT=/tmp/payroll-golden-storage/uploads/payroll-docs
PDF_DOCS_DIR=/tmp/payroll-golden-storage/pdf
NODE_ENV=production
```

The PDF documents are pre-compiled in the Docker image to `/app/.next/pdf`;
locally, build them once the way the Dockerfile does and point `PDF_DOCS_DIR`
at the output:

```
npx esbuild lib/pdf/payslip.tsx lib/pdf/signature-report.tsx lib/pdf/admin-report.tsx \
  lib/pdf/employee-guide.tsx lib/pdf/payslip-cut-sheet.tsx lib/pdf/payslip-batch-sheet.tsx \
  --bundle --platform=node --target=node20 --format=cjs --jsx=automatic \
  --outdir=/tmp/payroll-golden-storage/pdf --out-extension:.js=.js
```

(`PAYSLIP_STORAGE_DIR` matters: the publish job writes payslip PDFs there and
defaults to `/data/payslips`, which does not exist on a Mac.)

3. Page states the seed does not create. Start the built app once
   (`npx next build`, then `set -a; . ./.env.golden.local; set +a; npx next start -p 3111`),
   sign in as the owner, open Payroll -> the Sep 28 - Oct 04, 2026 period ->
   Publish (writes 22 payslips through the real job). Then:

```
psql -d payroll_mobile_ui <<'SQL'
-- one period paid by cash (the second most recent locked weekly period)
update pay_periods set state='PAID', payment_method='CASH', paid_at='2026-10-05T14:00:00Z'
 where id = (select id from pay_periods where state='LOCKED' and start_date='2026-09-21');
-- one acknowledged payslip and one disputed one on the published period
update payslips set acknowledged_at='2026-10-06T12:00:00Z'
 where id = (select id from payslips order by employee_id limit 1);
update payslips set dispute_reason='golden: wrong hours', disputed_at='2026-10-06T12:30:00Z'
 where id = (select id from payslips order by employee_id offset 1 limit 1);
SQL
```

## Running

```
npx next build
npm run golden:check     # compare; exit 1 with a unified diff per route
npm run golden:record    # rewrite tests/golden/ (decision required)
```

The server runs with `TZ=UTC`, `GOLDEN_NOW=2026-10-06T18:00:00Z` and
`NODE_OPTIONS=--require scripts/golden/fixed-clock.cjs`, which freezes
`Date.now()` and the no-argument `Date` constructor. Nothing in the Dockerfile
or the app loads that module. Normalization strips `<script>` elements,
`/_next/static/` build hashes, the footer's commit SHA and server time;
everything else, including whitespace, must match.
