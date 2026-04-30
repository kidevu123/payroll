# NGTeco troubleshooting

(Stub — Phase 2 fills this in once the Playwright pipeline is live.)

When NGTeco changes their portal UI:

1. Open the failed run in the admin "NGTeco" page. The screenshot + page HTML are inline.
2. Update `lib/ngteco/selectors.json` with the new selectors. No redeploy needed — the file is read fresh each run.
3. Re-run the import. The snapshot test in `lib/ngteco/__fixtures__` will fail loud first if the change broke parsing.

When 2FA is unexpectedly enabled on the service account:

The owner confirmed (§21 #3) that the NGTeco account does not use 2FA. If 2FA is detected during a run, the run fails with `INGEST_FAILED` and an admin notification. The fix is to disable 2FA on the NGTeco side; if NGTeco mandates it later, we'll add a TOTP secret as a setting.
