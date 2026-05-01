# NGTeco troubleshooting

The NGTeco import is the only step that depends on a vendor we can't change. This doc captures everything that has gone wrong and how to recover.

## How a run actually executes

1. **Schedule** — `payroll.run.tick` fires on `automation.payrollRun.cron`. Default: Sunday 7pm ET. Creates a `PayrollRun` row in `SCHEDULED`, enqueues `ngteco.import { runId }`.
2. **Ingest** — `ngteco.import` worker picks up the job. Loads selectors from `lib/ngteco/selectors.json` fresh, opens a Playwright persistent-context profile at `/data/ngteco/profile/`, navigates the portal, exports the punch CSV.
3. **Parse** — pure CSV parser produces `PunchCandidate[]` and `ParseError[]`.
4. **Match + dedupe** — candidates resolve to `Employee` rows by `ngtecoEmployeeRef`, dedupe against existing punches by `ngtecoRecordHash`.
5. **Persist** — matched candidates land as `Punch`s with `source=NGTECO_AUTO`. Unmatched / parse errors / dupes land in `ingest_exceptions`.
6. **Detect exceptions** → `payroll.run.detect-exceptions` runs. Either transitions to `AWAITING_EMPLOYEE_FIXES` (with deadline + employee notifications) or `AWAITING_ADMIN_REVIEW`.

Failures inside step 2–3 capture a screenshot + page HTML at `/data/ngteco/failures/<runId>/page.{png,html}`. The path is stamped on the `PayrollRun` row and surfaced on `/ngteco/<runId>`.

## When NGTeco changes their portal UI

Symptom: import fails partway, screenshot shows the new layout. The error message names the step that broke (e.g. `Timeout exceeded waiting for selector ... applyButton`).

1. Open `/ngteco/<runId>` in the admin UI. Screenshot is at the path shown.
2. SSH to the LXC. Edit selectors:
   ```
   sudo vi /opt/payroll/lib/ngteco/selectors.json
   ```
   Selectors are role/text/data-test based. Avoid CSS class names — they change. Examples that are stable across UI revisions:
   - `text=/Reports?/i` (case-insensitive contains)
   - `[role="button"][name="Export CSV"]`
   - `[data-test="punch-from-date"]`
3. Click **Retry ingest** on the failed run. Selectors reload fresh; no redeploy needed.
4. Once the import succeeds, commit the new selectors to the repo so the change isn't lost on the next deploy:
   ```
   ssh root@<lxc-host> 'pct exec 120 -- cat /opt/payroll/lib/ngteco/selectors.json' \
     > lib/ngteco/selectors.json
   git diff lib/ngteco/selectors.json
   git add lib/ngteco/selectors.json && git commit -m "chore(ngteco): selectors for NGTeco UI ($(date +%Y-%m))"
   git push
   ```

## When 2FA is unexpectedly enabled on the service account

The owner confirmed (spec §21 #3) the NGTeco account is configured without 2FA. The scraper's `ChallengeDetectedError` path fires if it sees a 2FA landmark on the post-login page; the run aborts immediately with `INGEST_FAILED` and **does not retry**.

Recovery: log into NGTeco directly with the service-account credentials, disable 2FA, then click **Retry ingest** on the failed run.

If NGTeco mandates 2FA in the future, the scraper needs a TOTP secret (vault-stored alongside the password). Add it to `ngtecoSchema` in `lib/settings/schemas.ts` and decrypt it in the same just-in-time path used by `username` / `password`.

## When CAPTCHA appears

Same path as 2FA: `ChallengeDetectedError("CAPTCHA")`. The scraper does **not** try to circumvent (per spec §22). Recovery is to log into NGTeco directly to dismiss the CAPTCHA, then retry. If CAPTCHA becomes routine, escalate to NGTeco support — automation cooperation is part of why the owner picked them.

## When unmatched references appear

Every NGTeco employee has a numeric `Employee ID`. The scraper writes that to `Punch.ngtecoRecordHash` and expects to find a matching `Employee.ngtecoEmployeeRef` in our DB. On the very first import, every candidate is unmatched (we haven't bound any refs yet).

Resolve from `/ngteco/<runId>`. The "Unmatched refs" panel lists each distinct ref. For now (Phase 2), the bind flow is manual:

```sql
UPDATE employees SET ngteco_employee_ref = '<their-id>' WHERE id = '<our-employee-uuid>';
```

The next import won't replay the matched candidates — they're already deduped by `ngtecoRecordHash`. A small follow-up admin "Bind" UI lands when there's a real source of unmatched refs to drive the design.

## When duplicates pile up

`ingest_exceptions.type='DUPLICATE_HASH'` rows are an idempotency win — the scraper saw the same row twice and the dedupe stopped it from doubling pay. They're informational, not actionable. Filter them out of the run-detail view if they get noisy; do not let "fix" them by deleting punches.

## When parse errors keep firing

Either NGTeco changed the column names or the CSV format itself. Update `lib/ngteco/parser.ts`:

- New column synonym → add to the `indexOf(...)` calls (snake_case after `normalizeHeader`).
- New date format → extend `normalizeDate`.
- New time format → extend `combineDateTime`.

The 100% branch coverage gate forces a test for the new path. Add a fixture row to `lib/ngteco/__fixtures__/sample-export.csv` plus a test in `parser.test.ts`.

## Other paths to know about

- **`/data/ngteco/profile/`** — Playwright persistent-context. Cookies + local storage. Wipe it if you suspect a corrupted session: `rm -rf /data/ngteco/profile`. The next run logs in fresh.
- **`/data/ngteco/failures/<runId>/`** — Captured artifacts. Cleaned up manually; nothing prunes them automatically. Delete after a successful re-run.
- **`payroll_runs.exception_snapshot`** — Used to persist a JSONB blob of every exception in Phase 1. Phase 2 promoted it to the `ingest_exceptions` table. The column still exists; new code doesn't write to it.
