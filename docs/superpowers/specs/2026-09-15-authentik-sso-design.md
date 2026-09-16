# Authentik SSO: provisioning and profile merge

Status: approved design, not yet implemented
Date: 2026-09-15
Branch plan: `feat/authentik-sso` off `rebuild/foundation`

## Problem

Authentik OIDC is half-wired. `lib/auth.ts` registers the provider and
`/login` renders a "Sign in with SSO" button, but the `signIn` callback is
**match-only**: it admits an Authentik login solely when the email Authentik
presents exactly equals an existing, non-disabled payroll user's email. There
is no provisioning in either direction and no profile sync. Consequences
today:

- A payroll user with no Authentik account cannot use SSO at all, and nothing
  tells anyone that account is missing. Payroll has 19 enabled users; Authentik
  has 10 human users.
- Email is the only join key, so changing an email on either side silently
  severs the link.
- Nothing reconciles the two directories. `docs/sso-user-mapping.md` documents
  a hand-merge performed on 2026-09-01; it is already drifting.

## Goals

1. Every enabled payroll user has a corresponding Authentik account, created
   automatically.
2. For a person present in both systems, Authentik is the source of truth for
   **profile identity** — display name and email.
3. The link survives an email change on either side.
4. Nothing about warehouse operations changes: employee email+password login
   and the kiosk PIN pad keep working exactly as they do now.

## Non-goals (explicitly out of scope)

- Authentik does **not** become the source of truth for payroll role, employee
  linkage, pay data, or enabled/disabled state. Those stay in payroll where
  they are audited and where the role matrix lives.
- Authentik-first user creation. An Authentik identity with no payroll user is
  rejected at sign-in, as it is today (with a better message). Payroll accounts
  carry money-relevant linkage; they are not created by an IdP login.
- Payroll never edits or deletes an existing Authentik user. It creates
  missing ones and links; that is all.
- No SMTP, no invite emails, no recovery links. The owner sets passwords in the
  Authentik admin UI.
- No SCIM/LDAP endpoint on the payroll side.

## Owner decisions captured

| Question | Decision |
| --- | --- |
| Who gets an Authentik account | **Everyone** (all enabled payroll users, employees included), but employees keep password + kiosk PIN login — SSO is optional for them |
| What Authentik overwrites | **Profile only**: display name + email. Role, employee linkage, pay, account state stay in payroll |
| When payroll pushes to Authentik | **On user create + nightly reconcile** |
| Credentials for new Authentik accounts | **None set by payroll.** Payroll creates the directory entry; the owner sets passwords in Authentik |

## Current state (measured 2026-09-15)

Payroll (LX120, `/opt/payroll`, branch `rebuild/foundation` @ `b6e7c38`):

- `users`: 33 rows, 19 with `disabled_at IS NULL` (1 OWNER, 1 ACCOUNTANT,
  17 EMPLOYEE). 32 of 33 linked to an `employees` row.
- `employees`: 18 ACTIVE, 8 INACTIVE, 19 TERMINATED.
- `users.password_hash` is NOT NULL.
- `AUTHENTIK_CLIENT_ID` / `_CLIENT_SECRET` / `_ISSUER` are all set in
  `/etc/payroll/.env`.
- Untracked on the server: `app/(auth)/login/sso-sign-in-form.tsx`, a
  POST+CSRF sign-in button written by hand to fix an unreliable first click,
  never committed. `docker-compose.override.yml` is untracked on purpose
  (publishes the DB port to Midas) and stays that way.
- The server checkout sits on a local branch `platform-mount` while
  `payroll-deploy.service` resets to `origin/rebuild/foundation`. Same commit
  today, but the mismatch is confusing and should be straightened.

Authentik (LXC 111, 192.168.1.164, issuer
`https://auth.booute.duckdns.org/application/o/payroll/`):

- Application `payroll` with a confidential OAuth2 provider,
  `sub_mode = hashed_user_id`, redirect URI
  `https://digitz.duckdns.org/api/auth/callback/authentik` (strict).
- **No policy bindings on the `payroll` application** — any Authentik user can
  complete the OIDC flow; only payroll's own `signIn` callback refuses them.
- Group `payroll-users` exists with 3 members (`akadmin`, `juanh`, `sahilk`).
- Username convention in use: first name + last initial, lowercase —
  `juanh`, `sahilk`, `seriv`, `sohanb`, `riteshk`, `sameerj`, `sashar`,
  `zeeshanv`.
- Existing API tokens `trade-show-provisioning` and `one-door-provisioning`
  establish the house precedent for app-driven provisioning. There is no
  `payroll-provisioning` token yet.

## Design

### 1. Link key

`sub` becomes the durable join key; email is only the bootstrap.

Migration `0048` adds to `users`:

| Column | Type | Meaning |
| --- | --- | --- |
| `authentik_sub` | `text`, unique, nullable | OIDC subject. Written on the first successful SSO login, matched by email that one time. Every later login matches on this. |
| `authentik_pk` | `integer`, nullable | Authentik's numeric user pk. Written by the provisioner; the handle for API calls. |
| `authentik_username` | `text`, nullable | Display/debug aid and the idempotency guard for username collisions. |
| `authentik_synced_at` | `timestamptz`, nullable | Last successful provision or link. |

`password_hash` stays NOT NULL: every payroll user is created locally first and
therefore always has a local password. No relaxation is needed and none is made.

The two link columns are learned independently — `authentik_pk` by the
provisioner, `authentik_sub` at first login — and either may be present alone.

### 2. Payroll to Authentik provisioning

`lib/authentik/client.ts` — a thin typed client:

- Config from env: `AUTHENTIK_API_URL`, `AUTHENTIK_API_TOKEN`.
- Zod-validated responses, explicit request timeouts, and it never logs the
  token or echoes it into an error message.
- Surface: `listUsers`, `findUserByEmail`, `findUserByUsername`, `createUser`,
  `findGroupByName`, `addUserToGroup`. Deliberately no update/delete.

`lib/authentik/provision.ts` — `provisionPayrollUser(userId)`, idempotent:

1. If `authentik_pk` is already set, return `{ status: "already-linked" }`.
2. Look up by email, then by the candidate username. If found, **link only** —
   write `authentik_pk`/`authentik_username`/`authentik_synced_at` and touch
   nothing in Authentik.
3. If absent, create with:
   - `username`: derived first name + last initial, lowercase, non-alphanumerics
     stripped; from the linked employee's legal/display name, falling back to
     the email local-part. On collision, append `2`, `3`, ... until free.
   - `name`: employee preferred/display name.
   - `email`: the payroll email.
   - `is_active: true`, `type: "internal"`, no password.
   - `attributes`: `{ payroll_user_id, payroll_role }` so the IdP shows where
     the account came from.
4. Add to the `payroll-users` group.
5. Write audit: `authentik.user.provisioned` or `authentik.user.linked`; on
   failure `authentik.sync.failed` with the error message (no secrets).

Call sites: `createStaffUser`, `inviteEmployeeUser`, and first-run setup. The
push is **best-effort** — a failure is logged and audited but never blocks or
rolls back payroll user creation.

`lib/jobs/handlers/authentik-reconcile.ts` — a nightly pg-boss job
(`authentik.reconcile`, default `0 3 * * *`) that walks enabled users with no
`authentik_pk` and provisions each. Self-heals anything missed by a failed push
or created before this feature existed.

### 3. Authentik to payroll merge at sign-in

In the `authentik` branch of the `signIn`/`jwt` callbacks:

1. Resolve the payroll user by `authentik_sub`; else by email (citext, so
   case-insensitive); else reject.
2. If resolved by email and `authentik_sub` is empty, write it.
3. Adopt `email` from Authentik onto `users.email` when it differs.
   **Guard:** if a different payroll user already owns that email, skip the
   change, write `authentik.merge.conflict`, and still admit the login. A
   profile-sync detail must never lock someone out or violate the unique index.
4. Adopt `name` from Authentik onto the linked `employees.display_name` when it
   is non-empty and differs.
5. `employees.email` is **not** touched — it is business data that appears on
   onboarding PDFs. (Open to reversal; called out to the owner.)
6. A disabled payroll user is rejected, unchanged from today.
7. Each applied change writes an audit row (`authentik.merge.applied`) with the
   before/after values. A login that changes nothing writes no row.

All merge logic is pure and unit-tested; the callback only performs I/O.

### 4. Login UX

- Commit `app/(auth)/login/sso-sign-in-form.tsx` (POST + CSRF token to
  `/api/auth/signin/authentik`) and wire it into `app/(auth)/login/page.tsx`,
  replacing the current server-action form. This is an existing fix that is
  live on the server but outside version control.
- Add a denial page for an Authentik identity with no payroll account: today
  Auth.js shows a generic `AccessDenied`. New copy names the email and says to
  ask the office. No emoji.

### 5. Authentik-side setup (LXC 111)

1. Create service account `svc-payroll-provisioning` and an API token
   `payroll-provisioning` bound to it — **not** an akadmin token.
2. Grant it the minimum: add/view users, view groups, add group membership.
3. Write the token to `/etc/payroll/.env` (mode 0600) as
   `AUTHENTIK_API_TOKEN`, with `AUTHENTIK_API_URL`. Add both to
   `docker-compose.yml` env passthrough. Never in chat, never in a commit.
4. Verify the provider's redirect URI matches the live `APP_URL`.
5. Bind the `payroll-users` group to the `payroll` application as a policy, so
   the IdP itself refuses non-payroll identities instead of relying only on the
   app callback. Safe to do because provisioning populates that group.

### 6. Settings lever and verification

Per the repo rule that behaviors are levers, a Settings card (Security section):

- Auto-provision on/off.
- Target group name (default `payroll-users`).
- Reconcile cron.
- A "who is missing" list.
- **Preview sync** — a dry run that reports exactly which Authentik accounts
  would be created, writing nothing.

Rollout order: run Preview sync and show the owner the list before any write
to the IdP. Then verify, in this order: staff SSO login end-to-end; employee
email+password login unchanged; kiosk PIN login unchanged; a second SSO login
by the same person is a no-op (no duplicate audit rows).

Rollback: unset `AUTHENTIK_CLIENT_ID` to remove the SSO button entirely, and
turn off auto-provision in Settings. No data is destroyed by either.

### 7. Version control and deploy

- Branch `feat/authentik-sso` off `rebuild/foundation`; merge back and push,
  which the 60-second deploy timer picks up.
- Migration generated with `npm run db:generate` and committed with the feature.
- `CLAUDE.md` and `docs/sso-user-mapping.md` updated in the same commit, per the
  repo's standing rule.
- Unit tests required: username derivation and collision suffixing, merge
  precedence including the email-conflict guard, provisioning idempotency.
- Straighten the server checkout onto `rebuild/foundation`; leave
  `docker-compose.override.yml` untracked.
- No force-push to `main`. No destructive Postgres operations. No secrets in
  commits.

## Risks

| Risk | Mitigation |
| --- | --- |
| Email adopted from Authentik collides with another payroll user | Conflict guard skips the change, audits it, admits the login |
| IdP unreachable during user creation | Push is best-effort; nightly reconcile retries |
| Provisioning creates junk accounts from bad name data | Preview sync is run and reviewed before the first live sweep; username derivation is unit-tested |
| Token leakage | Dedicated least-privilege service account, env file 0600, client never logs it |
| Any Authentik user reaching payroll | Group policy binding on the application plus the existing callback check |
