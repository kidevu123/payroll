# Authentik SSO: provisioning and profile ownership

Superseded 2026-09 by automatic provisioning. This file used to be a
hand-maintained table pairing each person's payroll account with their
Authentik username; that table drifted the moment anyone was added on
either side. Payroll now creates and links Authentik accounts itself, so
there is nothing left to hand-maintain here.

## How provisioning works

`lib/authentik/provision.ts` pushes a payroll user into Authentik. It runs
at two points:

1. **On user creation.** `createStaffUser`, `inviteEmployeeUser`, and
   first-run setup each fire a best-effort push
   (`provisionPayrollUserBestEffort`) after the payroll user is committed.
   It is bounded to an 8-second overall deadline — an unreachable or slow
   IdP never blocks or slows down creating a payroll user. Anything it
   can't finish in time is picked up by the nightly sweep below.
2. **Nightly reconcile.** A pg-boss job (`authentik.reconcile`, default
   `0 3 * * *`, company timezone) walks every enabled payroll user with no
   Authentik link yet and provisions each one. This is what makes the
   best-effort push safe to abandon early, and it also catches users
   created before this feature existed or during an IdP outage.

For a given payroll user, provisioning does exactly one of:

- **Link** — an Authentik account already exists with a matching email.
  Payroll records the link (`authentik_pk`, `authentik_username`) and
  changes nothing in Authentik.
- **Create** — no match by email. Payroll creates a new Authentik account
  (username derived from the employee's name, first-name + last-initial,
  lowercase, de-duplicated with a numeric suffix on collision; `name` set
  from `employees.displayName`, falling back to the email local-part; no
  password set — the owner sets that in the Authentik admin UI) and adds it
  to the target group (default `payroll-users`).
- **Needs review** — no email match, but the candidate username is already
  taken by a *different* Authentik account. Payroll cannot tell whether
  that's the same person under a changed email or a different person who
  happens to share a first name and last initial, so it refuses to guess.
  See below for how an admin resolves this.
- **Skip** — the user is disabled, already linked, or has no email.

Every outcome writes an audit row (`authentik.user.provisioned`,
`authentik.user.linked`, or `authentik.sync.failed` with the error message
and no secrets).

## What Authentik owns vs. what payroll owns

- **Authentik owns:** display name and email, for anyone who signs in via
  SSO at least once. A login adopts Authentik's `name` onto
  `employees.displayName` (the name printed on payslips and the onboarding
  PDF) and Authentik's `email` onto `users.email`, whenever they differ
  from what payroll currently has.
- **Payroll owns everything else:** role, employee linkage, pay, and
  enabled/disabled state. Authentik never touches these, and an SSO login
  from a disabled payroll user is refused exactly like today.
- **Payroll never edits or deletes an existing Authentik account.** The
  provisioner only creates a missing one and links; it has no update or
  delete calls into Authentik at all.
- `employees.email` (the business-record email used on onboarding
  paperwork) is deliberately **not** touched by the merge — only
  `users.email`, the login identifier.

The join key is the OIDC subject (`authentik_sub`), not email. Email is a
**one-time bootstrap**: the first successful SSO login for an account with
no subject bound yet matches by email and writes the subject. Every later
login must present that exact subject — a login with a different subject
is refused outright, even if its email matches, so a second Authentik
identity can't steal a bound payroll account by claiming its email address.

If the incoming email from Authentik would collide with a *different*
payroll user's email, the merge skips the email change, writes an
`authentik.merge.conflict` audit row, and still admits the login
unchanged. A profile-sync detail must never lock someone out.

## Resolving a "needs review" case

An admin sees these on `/settings/sso` (Preview sync or Run sync now).
There are two ways to clear one:

- If it's the same person (their Authentik email changed, breaking the
  email match), update their Authentik account's email back to the payroll
  email, or wait for them to sign in via SSO once their emails do match.
- If it's a genuine username collision between two different people,
  rename one of the conflicting Authentik usernames by hand, then re-run
  sync.

Nothing is created or changed automatically for a needs-review case —
that's the point of stopping instead of guessing.

## The settings page

`/settings/sso` (Security section) is the lever for all of this:

- **Auto-provision** on/off — turning it off stops both the create-time
  push and the nightly reconcile from firing (an unschedule happens
  immediately on save, not just on the next restart).
- **Target group name** (default `payroll-users`).
- **Reconcile schedule (cron)** — validated as a standard five-field cron
  expression on save; a bad value is rejected with an error instead of
  being written. Changing it re-arms the live schedule immediately.
- **Preview sync** — a dry run. It reports exactly what a real sync would
  do (create / link / needs-review / skip, per user) and **writes
  nothing**, to Authentik or to payroll. Always run this before the first
  live sweep.
- **Run sync now** — the same pass for real, provisioning everything it
  can and writing audit rows for what happened.
- **Linked accounts** — the list of enabled payroll users and their link
  state, with the unlink action described next.

## Unlink escape hatch

Once a payroll user is bound to an Authentik subject, sign-in refuses any
other subject for that account (the anti-takeover guard above). If an
Authentik identity is ever re-created out from under a person — deleted
and re-added, a tenant migration — the account becomes unreachable by SSO
because its stored subject no longer exists. **Unlink** on `/settings/sso`
clears the stored `authentik_sub`/`authentik_pk`/`authentik_username`
binding for that payroll user (audited as `authentik.user.unlinked`, with
the cleared values in `before`). It requires a confirm step. After
unlinking, the next SSO sign-in binds fresh to whichever Authentik
identity presents — so only unlink when you're sure the old binding is
stale; a premature unlink lets a different Authentik identity claim the
account on the next login.

## Where the API token lives

`AUTHENTIK_API_URL` and `AUTHENTIK_API_TOKEN` live in `/etc/payroll/.env`
on LX120, mode 0600, passed through `docker-compose.yml`. The token
belongs to a dedicated least-privilege service account
(`svc-payroll-provisioning`), not an admin token — it can add/view users
and manage group membership and nothing more. Never paste it into chat or
a commit; `lib/authentik/client.ts` never logs it or echoes it into an
error message.
