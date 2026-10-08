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
or the app loads that module. Normalization masks React `useId` tokens (`_R_…_`: they encode a component's
position in the tree, so they shift when markup moves into a child component),
strips `<script>` elements,
`/_next/static/` build hashes, the footer's commit SHA and server time;
everything else, including whitespace, must match.

### Added for the reports table split (2026-10-08)

Two runs on one locked period (the multi-run sub-lines) and one Salaried-tab
paystub upload with no payroll run (the salaried paystub line):

```
psql -d payroll_mobile_ui <<'SQL'
insert into payroll_runs (id, period_id, state, scheduled_for, published_at, source, total_amount_cents, created_by_name, posted_at, created_at)
values
 ('11111111-1111-4111-8111-111111111111',(select id from pay_periods where start_date='2026-09-14'),'PUBLISHED','2026-09-20T23:00:00Z','2026-09-21T13:00:00Z','MANUAL_CSV',1200000,'Owner','2026-09-21T13:00:00Z','2026-09-21T13:00:00Z'),
 ('22222222-2222-4222-8222-222222222222',(select id from pay_periods where start_date='2026-09-14'),'PUBLISHED','2026-09-20T23:00:00Z','2026-09-22T15:30:00Z','MANUAL_CSV',340000,'Owner','2026-09-22T15:30:00Z','2026-09-22T15:30:00Z');
insert into payroll_period_documents (id, period_id, employee_id, kind, file_path, mime, original_filename, size_bytes, uploaded_by_id, uploaded_at, pay_period_start, pay_period_end, amount_cents)
values ('33333333-3333-4333-8333-333333333333', null, (select id from employees where display_name='Aaliyah Hernandez'), 'PAYSTUB', '/tmp/payroll-golden-storage/uploads/payroll-docs/golden-paystub.pdf', 'application/pdf', 'golden-paystub.pdf', 1024, (select id from users where role='OWNER'), '2026-09-01T14:00:00Z', '2026-08-01', '2026-08-31', 412345);
SQL
```

These were recorded from the pre-split code (commit fc86d7e) and then checked
against the split, which is how a golden is legitimately added: record on the
known-good code, compare on the new.

### Added for the next-tier files (2026-10-08)

Approved time off on days with no punches (time-off cells), a schedule note
(must NOT hide punches), a pending request, and a salaried employee:

```
psql -d payroll_mobile_ui <<'SQL'
-- approved time off on days with no punches, so the grid shows time-off cells
insert into time_off_requests (id, employee_id, start_date, end_date, type, reason, status, resolved_by_id, resolved_at, created_at) values
 ('44444444-4444-4444-8444-444444444441','619253b9-8419-41bd-bc94-d1e91d5b4b87','2026-10-11','2026-10-11','SICK','golden: sick','APPROVED','b459d50e-b132-42d3-b725-6c5bfc0493ff','2026-10-05T15:00:00Z','2026-10-05T14:00:00Z'),
 ('44444444-4444-4444-8444-444444444442','64bb68c2-84a5-44dd-82c6-4a6f82ef025b','2026-10-04','2026-10-04','PERSONAL','golden: pto','APPROVED','b459d50e-b132-42d3-b725-6c5bfc0493ff','2026-10-01T15:00:00Z','2026-10-01T14:00:00Z'),
 ('44444444-4444-4444-8444-444444444443','aafbd56e-33ae-49f4-b6dd-133bc5124f5c','2026-10-11','2026-10-11','UNPAID','golden: unpaid','APPROVED','b459d50e-b132-42d3-b725-6c5bfc0493ff','2026-10-05T15:00:00Z','2026-10-05T14:00:00Z'),
 ('44444444-4444-4444-8444-444444444444','619253b9-8419-41bd-bc94-d1e91d5b4b87','2026-10-06','2026-10-06','SCHEDULE_NOTE','golden: leaving early','APPROVED','b459d50e-b132-42d3-b725-6c5bfc0493ff','2026-10-05T15:00:00Z','2026-10-05T14:00:00Z'),
 ('44444444-4444-4444-8444-444444444445','bb29fe2b-a887-49a7-b8f2-fadddf598916','2026-10-20','2026-10-21','OTHER','golden: appointment','PENDING',null,null,'2026-10-06T13:00:00Z');
-- a salaried employee (Salaried tab; excluded from the time grid and period totals)
insert into employees (id, display_name, legal_name, email, hired_on, pay_type, status, shift_id, language, created_at, updated_at)
values ('55555555-5555-4555-8555-555555555555','Golden Salaried','Golden Salaried','golden.salaried@example.com','2026-01-05','SALARIED','ACTIVE','ceb1ae49-2f5d-4531-adfc-0b8e45ab468f','en','2026-01-05T12:00:00Z','2026-01-05T12:00:00Z');
SQL
```

The ids are the demo database's (Elena Rojas, James Walker, Sofia Patel,
Marcus Brown, the owner, the Day shift); look them up if the database is
rebuilt. With this data every golden was re-recorded from the ORIGINAL
pre-refactor commit (d2f8579) in a worktree and the refactored code was
checked against it.
