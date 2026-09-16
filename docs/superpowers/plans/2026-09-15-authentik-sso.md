# Authentik SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every enabled payroll user gets an Authentik account created automatically, and for anyone present in both systems Authentik becomes the source of truth for display name and email.

**Architecture:** A small typed Authentik admin-API client plus a pure decision core (`decideProvision`, `computeProfileMerge`, `deriveUsername`) that is fully unit-tested; thin I/O wrappers call it from three places — user-creation call sites (best-effort push), a nightly pg-boss reconcile job, and the Auth.js `signIn`/`jwt` callbacks (profile merge). A new `authentik_sub` column becomes the durable join key so an email change on either side cannot orphan an account.

**Tech Stack:** Next.js 15 App Router, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Drizzle + Postgres 16, Auth.js v5, pg-boss, Zod, vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-authentik-sso-design.md`

**Branch:** `feat/authentik-sso` (already created, off `rebuild/foundation` @ `b6e7c38`)

## Global Constraints

- **No emoji.** Anywhere: UI, copy, comments, commit messages, PDFs, notification text.
- **Authz at the action layer.** Every server action starts with `requireAdmin()` / `requireOwner()` from `lib/auth-guards`.
- **Server actions validate with Zod** and live in `actions.ts` next to their page, starting with `"use server"`.
- **Every mutation writes an audit row** via `writeAudit()` from `lib/db/audit` before commit.
- **Pure logic in `/lib` is unit-tested.** `npm run test` runs vitest with coverage.
- **Soft-delete only.** This feature deletes nothing, in either system.
- **Settings are levers** — anything company-specific is reachable from `/admin/settings`.
- **Secrets never enter chat, logs, error messages, or commits.** `AUTHENTIK_API_TOKEN` lives only in `/etc/payroll/.env` (mode 0600) on LX120.
- **Payroll never modifies or deletes an existing Authentik user.** It creates missing ones and links. Create + group-add are the only writes.
- **Never force-push to `main`.** `main` stays untouched.
- **Gates before every commit:** `npm run typecheck`, `npm run lint`, `npm run test`.
- Node/TS conventions: use the `...(x !== undefined ? { k: x } : {})` spread idiom for optional fields (`exactOptionalPropertyTypes` rejects `k: undefined`).

## Verified facts this plan depends on

Confirmed by reading the running Authentik source at `/opt/authentik/authentik/core/api/` on LXC 111 (2026-09-15):

- `GET /api/v3/core/users/?email=<email>` — exact filter, `email` is in `UsersFilter.Meta.fields`.
- `GET /api/v3/core/users/?username=<username>` — exact filter, same list.
- `POST /api/v3/core/users/` — `UserSerializer` accepts `username`, `name`, `email`, `is_active`, `attributes`, `path`, `type`.
- `GET /api/v3/core/groups/?name=<name>` — exact filter, `name` is in `GroupFilter.Meta.fields`.
- `POST /api/v3/core/groups/<group_uuid>/add_user/` with body `{"pk": <user_pk>}` — guarded by permission `authentik_core.add_user_to_group`.
- Auth header: `Authorization: Bearer <token>`.
- Existing group `payroll-users` (members: `akadmin`, `juanh`, `sahilk`).
- Application `payroll`: confidential OAuth2 provider, `sub_mode = hashed_user_id`, redirect URI `https://digitz.duckdns.org/api/auth/callback/authentik` (strict), **no policy bindings**.
- Authentik management shell, verified working on 2026-09-15: `cd /opt/authentik && set -a; . /etc/default/authentik; set +a; sudo -u authentik -H env HOME=/opt/authentik /usr/local/bin/uv run python -m manage shell`. `HOME` is required — the authentik account's home is `/opt/authentik` and without it `uv` fails with `Failed to initialize cache at /root/.cache/uv`. The container prints a login banner on stdout, so any captured value must be read from the last line.

## Refinement to the spec (adopted, and why)

The spec says the provisioner looks a user up "by email, then by the candidate username". Matching on username is **not** safe to automate: a username hit can equally mean "same person, email changed in the IdP" or "a different person with the same first name and last initial", and the two are indistinguishable from payroll's side. Linking the wrong one hands someone else's SSO identity a payroll account.

This plan therefore resolves the three cases deterministically:

1. Authentik account with that email exists → **link**.
2. No email match and the candidate username is free → **create**.
3. No email match and the candidate username is taken → **needs-review**. Nothing is written. Preview sync and the Settings page name the account and the reason; the owner fixes the email in Authentik and the next reconcile links it automatically.

No silent duplicates, no silent mislinks, and the ambiguous case self-heals once a human resolves it.

## File structure

| File | Responsibility |
| --- | --- |
| `lib/db/schema.ts` (modify) | Four link columns + unique index on `users` |
| `drizzle/00NN_*.sql` (generated) | The migration |
| `lib/db/queries/users.ts` (modify) | `findUserByAuthentikSub`, `linkAuthentikAccount`, `applyAuthentikProfile`, `listUsersMissingAuthentik`, `listEnabledUsersForProvisioning` |
| `lib/db/queries/employees.ts` (modify) | `setEmployeeDisplayName` |
| `lib/authentik/username.ts` + `.test.ts` | Pure username derivation (first name + last initial, sanitized) |
| `lib/authentik/merge.ts` + `.test.ts` | Pure profile-merge precedence, including the email-conflict guard |
| `lib/authentik/decide.ts` + `.test.ts` | Pure link/create/needs-review decision |
| `lib/authentik/client.ts` + `.test.ts` | Typed admin-API client (create + link reads only) |
| `lib/authentik/provision.ts` | I/O wrapper: payroll user -> decision -> API call -> link row + audit |
| `lib/jobs/handlers/authentik-reconcile.ts` | Nightly sweep over unlinked enabled users |
| `lib/jobs/index.ts` (modify) | Queue + cron registration |
| `lib/settings/schemas.ts` (modify) | `ssoSchema` + registry entry |
| `lib/auth.ts` (modify) | Resolve by sub, then email; apply merge; audit |
| `app/(admin)/settings/sso/{page,actions,sso-form}.tsx` | Settings lever, missing list, Preview sync |
| `app/(admin)/settings/settings-nav.tsx` (modify) | Nav entry |
| `app/(auth)/login/sso-sign-in-form.tsx` | POST+CSRF SSO button (currently untracked on the server) |
| `app/(auth)/login/page.tsx` (modify) | Use the form; render the access-denied message |
| `docker-compose.yml` (modify) | Pass `AUTHENTIK_API_URL` / `AUTHENTIK_API_TOKEN` |
| `docs/sso-user-mapping.md`, `CLAUDE.md` (modify) | Documentation, same commit as the feature |

---

### Task 1: Link columns on `users`

**Files:**
- Modify: `lib/db/schema.ts` (users table, ~line 171-200)
- Create: `drizzle/00NN_<generated>.sql` via `npm run db:generate`
- Modify: `lib/db/queries/users.ts`
- Modify: `lib/db/queries/employees.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `findUserByAuthentikSub(sub: string): Promise<User | null>`; `linkAuthentikAccount(userId: string, link: { sub?: string; pk?: number; username?: string }): Promise<void>`; `applyAuthentikProfile(userId: string, patch: { email?: string }): Promise<void>`; `listUsersMissingAuthentik(): Promise<User[]>`; `setEmployeeDisplayName(employeeId: string, displayName: string): Promise<void>`. New `User` fields: `authentikSub: string | null`, `authentikPk: number | null`, `authentikUsername: string | null`, `authentikSyncedAt: Date | null`.

- [ ] **Step 1: Add the columns to the schema**

In `lib/db/schema.ts`, inside the `users` table definition, after `disabledAt`:

```ts
    // Authentik SSO link. `authentikSub` is the OIDC subject, learned on the
    // first successful SSO login (matched by email that one time) and used as
    // the join key forever after, so an email change on either side cannot
    // orphan the account. `authentikPk` / `authentikUsername` are learned by
    // the provisioner and are the handle for admin-API calls. Either may be
    // present without the other.
    authentikSub: text("authentik_sub"),
    authentikPk: integer("authentik_pk"),
    authentikUsername: text("authentik_username"),
    authentikSyncedAt: timestamp("authentik_synced_at", { withTimezone: true }),
```

And extend the index list at the end of the table:

```ts
  (t) => [
    uniqueIndex("users_email_unique").on(t.email),
    // Nullable, so Postgres allows many unlinked rows; one payroll user per
    // Authentik subject once linked.
    uniqueIndex("users_authentik_sub_unique").on(t.authentikSub),
  ],
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0048_*.sql` plus an updated `drizzle/meta/_journal.json` (last existing tag is `0047_payslip_signature`).

- [ ] **Step 3: Read the generated SQL and confirm it is additive**

Run: `cat drizzle/0048_*.sql`
Expected: only `ALTER TABLE "users" ADD COLUMN ...` and `CREATE UNIQUE INDEX ...`. If it contains any `DROP`, stop and report — this migration must not touch existing data.

- [ ] **Step 4: Apply it to a throwaway database**

```bash
createdb payroll_ssotest
DATABASE_URL="postgres://$(whoami)@localhost:5432/payroll_ssotest" npm run db:migrate
psql -d payroll_ssotest -c '\d users' | grep authentik
```
Expected: the four columns listed, plus `users_authentik_sub_unique`.

- [ ] **Step 5: Add the query helpers**

In `lib/db/queries/users.ts`:

```ts
export async function findUserByAuthentikSub(sub: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.authentikSub, sub))
    .limit(1);
  return row ?? null;
}

/**
 * Record what we now know about a user's Authentik account. Fields are
 * written only when supplied — `authentikSub` is learned at login,
 * `authentikPk`/`authentikUsername` by the provisioner, and neither should
 * clobber the other.
 */
export async function linkAuthentikAccount(
  userId: string,
  link: { sub?: string; pk?: number; username?: string },
): Promise<void> {
  await db
    .update(users)
    .set({
      ...(link.sub !== undefined ? { authentikSub: link.sub } : {}),
      ...(link.pk !== undefined ? { authentikPk: link.pk } : {}),
      ...(link.username !== undefined ? { authentikUsername: link.username } : {}),
      authentikSyncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/** Apply IdP-owned profile fields. Only email lives on the user row. */
export async function applyAuthentikProfile(
  userId: string,
  patch: { email: string },
): Promise<void> {
  await db
    .update(users)
    .set({ email: patch.email, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

/** Enabled payroll users with no Authentik account linked yet. */
export async function listUsersMissingAuthentik(): Promise<User[]> {
  return db
    .select()
    .from(users)
    .where(sql`${users.disabledAt} is null and ${users.authentikPk} is null`);
}
```

In `lib/db/queries/employees.ts`:

```ts
/**
 * Narrow setter used by the Authentik profile merge. Deliberately not
 * updateEmployee(): the merge touches exactly one field and must not run the
 * full employee-update validation or its side effects.
 */
export async function setEmployeeDisplayName(
  employeeId: string,
  displayName: string,
): Promise<void> {
  await db
    .update(employees)
    .set({ displayName, updatedAt: new Date() })
    .where(eq(employees.id, employeeId));
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `employees.updatedAt` does not exist, drop it from the `.set()` and re-run.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/db/queries/users.ts lib/db/queries/employees.ts drizzle/
git commit -m "feat(auth): Authentik link columns on users

authentik_sub is the durable join key learned at first SSO login;
authentik_pk/username are the admin-API handle learned by the
provisioner. Additive migration, no data touched."
```

---

### Task 2: Username derivation (pure, TDD)

**Files:**
- Create: `lib/authentik/username.ts`
- Test: `lib/authentik/username.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `deriveAuthentikUsername(input: { name: string | null; email: string }): string`

The convention in the live directory is first name + last initial, lowercase: `juanh`, `sahilk`, `seriv`, `sohanb`, `riteshk`, `sameerj`, `sashar`, `zeeshanv`.

- [ ] **Step 1: Write the failing test**

Create `lib/authentik/username.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveAuthentikUsername } from "./username";

describe("deriveAuthentikUsername (matches the live directory convention)", () => {
  it("is first name plus last initial, lowercased", () => {
    expect(deriveAuthentikUsername({ name: "Juan Herrera", email: "juan@gmail.com" })).toBe("juanh");
    expect(deriveAuthentikUsername({ name: "Sahil Khatri", email: "sahil@boomin.com" })).toBe("sahilk");
  });

  it("uses the last word as the surname when there are middle names", () => {
    expect(deriveAuthentikUsername({ name: "Ana Maria Gomez", email: "a@x.com" })).toBe("anag");
  });

  it("strips accents, spaces, and punctuation", () => {
    expect(deriveAuthentikUsername({ name: "José O'Neill-Vega", email: "j@x.com" })).toBe("joseo");
  });

  it("falls back to the first name alone when there is no surname", () => {
    expect(deriveAuthentikUsername({ name: "Eshal", email: "e@x.com" })).toBe("eshal");
  });

  it("falls back to the email local-part when the name is empty or unusable", () => {
    expect(deriveAuthentikUsername({ name: null, email: "Payroll.Admin@boomin.com" })).toBe("payrolladmin");
    expect(deriveAuthentikUsername({ name: "   ", email: "chintu@gmail.com" })).toBe("chintu");
  });

  it("never returns an empty string", () => {
    expect(deriveAuthentikUsername({ name: "!!!", email: "!!!@x.com" }).length).toBeGreaterThan(0);
  });
});
```

The accent case expects `joseo`: `José` normalizes to `jose`, `O'Neill-Vega` to `oneillvega`, initial `o`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/authentik/username.test.ts`
Expected: FAIL — `Cannot find module './username'`.

- [ ] **Step 3: Implement**

Create `lib/authentik/username.ts`:

```ts
// Authentik username derivation.
//
// The live directory uses first name + last initial, lowercase (juanh,
// sahilk, seriv, sohanb). New accounts follow the same shape so the IdP
// stays readable; collisions are handled by the caller, which refuses to
// guess rather than appending a number (see lib/authentik/decide.ts).

/** Lowercase, strip accents, keep [a-z0-9]. */
function slug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function deriveAuthentikUsername(input: {
  name: string | null;
  email: string;
}): string {
  const words = (input.name ?? "")
    .trim()
    .split(/\s+/)
    .map(slug)
    .filter((w) => w.length > 0);

  if (words.length >= 2) {
    const first = words[0]!;
    const surname = words[words.length - 1]!;
    return `${first}${surname.slice(0, 1)}`;
  }
  if (words.length === 1) return words[0]!;

  const local = slug(input.email.split("@")[0] ?? "");
  return local.length > 0 ? local : "user";
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/authentik/username.test.ts`
Expected: PASS, 6 tests. If a case fails, fix the implementation, not the test.

- [ ] **Step 5: Commit**

```bash
git add lib/authentik/username.ts lib/authentik/username.test.ts
git commit -m "feat(authentik): username derivation matching the live directory convention"
```

---

### Task 3: Profile-merge precedence (pure, TDD)

**Files:**
- Create: `lib/authentik/merge.ts`
- Test: `lib/authentik/merge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export type ProfileMerge = {
  email: { from: string; to: string } | null;
  displayName: { from: string; to: string } | null;
  conflicts: { field: "email"; reason: "taken-by-another-payroll-user"; value: string }[];
};
export function computeProfileMerge(input: {
  payrollEmail: string;
  payrollDisplayName: string | null;
  idpEmail: string | null;
  idpName: string | null;
  emailTakenByAnotherUser: boolean;
}): ProfileMerge;
```

- [ ] **Step 1: Write the failing test**

Create `lib/authentik/merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeProfileMerge } from "./merge";

const base = {
  payrollEmail: "juan@gmail.com",
  payrollDisplayName: "Juan H",
  idpEmail: "juan@gmail.com",
  idpName: "Juan H",
  emailTakenByAnotherUser: false,
};

describe("computeProfileMerge (Authentik owns name + email, nothing else)", () => {
  it("proposes nothing when both sides already agree", () => {
    const m = computeProfileMerge(base);
    expect(m.email).toBeNull();
    expect(m.displayName).toBeNull();
    expect(m.conflicts).toEqual([]);
  });

  it("adopts the IdP email when it differs", () => {
    const m = computeProfileMerge({ ...base, idpEmail: "juan.herrera@boomin.com" });
    expect(m.email).toEqual({ from: "juan@gmail.com", to: "juan.herrera@boomin.com" });
  });

  it("treats email comparison as case-insensitive", () => {
    const m = computeProfileMerge({ ...base, idpEmail: "Juan@Gmail.com" });
    expect(m.email).toBeNull();
  });

  it("adopts the IdP display name when it differs", () => {
    const m = computeProfileMerge({ ...base, idpName: "Juan Herrera" });
    expect(m.displayName).toEqual({ from: "Juan H", to: "Juan Herrera" });
  });

  it("ignores empty or whitespace-only IdP values rather than blanking ours", () => {
    const m = computeProfileMerge({ ...base, idpName: "   ", idpEmail: "" });
    expect(m.email).toBeNull();
    expect(m.displayName).toBeNull();
  });

  it("refuses an email already owned by another payroll user, and says so", () => {
    const m = computeProfileMerge({
      ...base,
      idpEmail: "seri@boomin.com",
      emailTakenByAnotherUser: true,
    });
    expect(m.email).toBeNull();
    expect(m.conflicts).toEqual([
      { field: "email", reason: "taken-by-another-payroll-user", value: "seri@boomin.com" },
    ]);
  });

  it("proposes a display name even when the payroll side has none", () => {
    const m = computeProfileMerge({ ...base, payrollDisplayName: null, idpName: "Juan Herrera" });
    expect(m.displayName).toEqual({ from: "", to: "Juan Herrera" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/authentik/merge.test.ts`
Expected: FAIL — `Cannot find module './merge'`.

- [ ] **Step 3: Implement**

Create `lib/authentik/merge.ts`:

```ts
// Profile merge precedence: Authentik owns display name and email.
//
// Deliberately NOT owned by the IdP: payroll role, employee linkage, pay
// data, enabled/disabled. Those are business facts, audited on the payroll
// side, and an IdP edit must never move them.
//
// Pure — no I/O. The caller resolves `emailTakenByAnotherUser` and applies
// whatever this returns.

export type ProfileMerge = {
  email: { from: string; to: string } | null;
  displayName: { from: string; to: string } | null;
  conflicts: {
    field: "email";
    reason: "taken-by-another-payroll-user";
    value: string;
  }[];
};

function clean(value: string | null): string {
  return (value ?? "").trim();
}

export function computeProfileMerge(input: {
  payrollEmail: string;
  payrollDisplayName: string | null;
  idpEmail: string | null;
  idpName: string | null;
  emailTakenByAnotherUser: boolean;
}): ProfileMerge {
  const merge: ProfileMerge = { email: null, displayName: null, conflicts: [] };

  const idpEmail = clean(input.idpEmail);
  const payrollEmail = clean(input.payrollEmail);
  if (idpEmail.length > 0 && idpEmail.toLowerCase() !== payrollEmail.toLowerCase()) {
    if (input.emailTakenByAnotherUser) {
      // Never break the unique index and never lock anyone out over a
      // profile detail: skip, report, admit the login.
      merge.conflicts.push({
        field: "email",
        reason: "taken-by-another-payroll-user",
        value: idpEmail,
      });
    } else {
      merge.email = { from: payrollEmail, to: idpEmail };
    }
  }

  const idpName = clean(input.idpName);
  const payrollName = clean(input.payrollDisplayName);
  if (idpName.length > 0 && idpName !== payrollName) {
    merge.displayName = { from: payrollName, to: idpName };
  }

  return merge;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/authentik/merge.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/authentik/merge.ts lib/authentik/merge.test.ts
git commit -m "feat(authentik): profile merge precedence with an email-conflict guard"
```

---

### Task 4: Provisioning decision (pure, TDD)

**Files:**
- Create: `lib/authentik/decide.ts`
- Test: `lib/authentik/decide.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export type ProvisionDecision =
  | { action: "skip"; reason: "already-linked" | "disabled" | "no-email" }
  | { action: "link"; authentikPk: number; username: string }
  | { action: "create"; username: string }
  | { action: "needs-review"; reason: "username-taken"; username: string };
export function decideProvision(input: {
  alreadyLinked: boolean;
  disabled: boolean;
  email: string;
  candidateUsername: string;
  matchByEmail: { pk: number; username: string } | null;
  usernameTaken: boolean;
}): ProvisionDecision;
```

- [ ] **Step 1: Write the failing test**

Create `lib/authentik/decide.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideProvision } from "./decide";

const base = {
  alreadyLinked: false,
  disabled: false,
  email: "juan@gmail.com",
  candidateUsername: "juanh",
  matchByEmail: null,
  usernameTaken: false,
};

describe("decideProvision", () => {
  it("creates when nothing in the IdP matches", () => {
    expect(decideProvision(base)).toEqual({ action: "create", username: "juanh" });
  });

  it("links when an Authentik account already has that email", () => {
    expect(
      decideProvision({ ...base, matchByEmail: { pk: 7, username: "juanh" } }),
    ).toEqual({ action: "link", authentikPk: 7, username: "juanh" });
  });

  it("is a no-op for an already-linked user", () => {
    expect(decideProvision({ ...base, alreadyLinked: true })).toEqual({
      action: "skip",
      reason: "already-linked",
    });
  });

  it("skips disabled payroll users", () => {
    expect(decideProvision({ ...base, disabled: true })).toEqual({
      action: "skip",
      reason: "disabled",
    });
  });

  it("skips a user with no email", () => {
    expect(decideProvision({ ...base, email: "  " })).toEqual({
      action: "skip",
      reason: "no-email",
    });
  });

  it("refuses to guess when the username is taken by an account with a different email", () => {
    expect(decideProvision({ ...base, usernameTaken: true })).toEqual({
      action: "needs-review",
      reason: "username-taken",
      username: "juanh",
    });
  });

  it("prefers an email match over the username-taken check", () => {
    expect(
      decideProvision({
        ...base,
        usernameTaken: true,
        matchByEmail: { pk: 7, username: "juanh" },
      }),
    ).toEqual({ action: "link", authentikPk: 7, username: "juanh" });
  });

  it("checks already-linked before anything else", () => {
    expect(
      decideProvision({ ...base, alreadyLinked: true, disabled: true, email: "" }),
    ).toEqual({ action: "skip", reason: "already-linked" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/authentik/decide.test.ts`
Expected: FAIL — `Cannot find module './decide'`.

- [ ] **Step 3: Implement**

Create `lib/authentik/decide.ts`:

```ts
// Which of the three things to do with one payroll user.
//
// Matching is by EMAIL only. A username hit is ambiguous — it can mean "the
// same person whose email changed in the IdP" or "a different person with the
// same first name and last initial" — and payroll cannot tell those apart.
// Linking the wrong one would hand someone else's SSO identity a payroll
// account, so that case stops and asks for a human instead of guessing.

export type ProvisionDecision =
  | { action: "skip"; reason: "already-linked" | "disabled" | "no-email" }
  | { action: "link"; authentikPk: number; username: string }
  | { action: "create"; username: string }
  | { action: "needs-review"; reason: "username-taken"; username: string };

export function decideProvision(input: {
  alreadyLinked: boolean;
  disabled: boolean;
  email: string;
  candidateUsername: string;
  matchByEmail: { pk: number; username: string } | null;
  usernameTaken: boolean;
}): ProvisionDecision {
  if (input.alreadyLinked) return { action: "skip", reason: "already-linked" };
  if (input.disabled) return { action: "skip", reason: "disabled" };
  if (input.email.trim().length === 0) return { action: "skip", reason: "no-email" };

  if (input.matchByEmail) {
    return {
      action: "link",
      authentikPk: input.matchByEmail.pk,
      username: input.matchByEmail.username,
    };
  }
  if (input.usernameTaken) {
    return { action: "needs-review", reason: "username-taken", username: input.candidateUsername };
  }
  return { action: "create", username: input.candidateUsername };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/authentik/decide.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/authentik/decide.ts lib/authentik/decide.test.ts
git commit -m "feat(authentik): provisioning decision — link by email, create, or ask a human"
```

---

### Task 5: Authentik admin-API client

**Files:**
- Create: `lib/authentik/client.ts`
- Test: `lib/authentik/client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
```ts
export type AuthentikUser = { pk: number; username: string; name: string; email: string; isActive: boolean };
export type AuthentikGroup = { pk: string; name: string };
export type AuthentikClient = {
  findUserByEmail(email: string): Promise<AuthentikUser | null>;
  findUserByUsername(username: string): Promise<AuthentikUser | null>;
  createUser(input: { username: string; name: string; email: string; attributes: Record<string, unknown> }): Promise<AuthentikUser>;
  findGroupByName(name: string): Promise<AuthentikGroup | null>;
  addUserToGroup(groupPk: string, userPk: number): Promise<void>;
};
export class AuthentikApiError extends Error { readonly status?: number }
export function readAuthentikConfig(): { apiUrl: string; token: string } | null;
export function createAuthentikClient(config: { apiUrl: string; token: string }, fetchImpl?: typeof fetch): AuthentikClient;
export function getAuthentikClient(): AuthentikClient | null;
```

- [ ] **Step 1: Write the failing test**

Create `lib/authentik/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAuthentikClient, AuthentikApiError } from "./client";

const CONFIG = { apiUrl: "https://auth.example.test/api/v3", token: "secret-token-value" };

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[i++] ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const AK_USER = {
  pk: 12,
  username: "juanh",
  name: "Juan Herrera",
  email: "juan@gmail.com",
  is_active: true,
};

describe("AuthentikClient", () => {
  it("finds a user by exact email and maps the payload", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { results: [AK_USER] } }]);
    const user = await createAuthentikClient(CONFIG, impl).findUserByEmail("juan@gmail.com");
    expect(user).toEqual({
      pk: 12,
      username: "juanh",
      name: "Juan Herrera",
      email: "juan@gmail.com",
      isActive: true,
    });
    expect(calls[0]!.url).toBe(
      "https://auth.example.test/api/v3/core/users/?email=juan%40gmail.com",
    );
  });

  it("sends the token as a bearer header", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: { results: [] } }]);
    await createAuthentikClient(CONFIG, impl).findUserByEmail("nobody@x.com");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer secret-token-value");
  });

  it("returns null when nothing matches", async () => {
    const { impl } = fakeFetch([{ status: 200, body: { results: [] } }]);
    expect(await createAuthentikClient(CONFIG, impl).findUserByEmail("nobody@x.com")).toBeNull();
  });

  it("creates a user as an active internal account with no password", async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: AK_USER }]);
    const created = await createAuthentikClient(CONFIG, impl).createUser({
      username: "juanh",
      name: "Juan Herrera",
      email: "juan@gmail.com",
      attributes: { payroll_user_id: "abc", payroll_role: "EMPLOYEE" },
    });
    expect(created.pk).toBe(12);
    expect(calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toEqual({
      username: "juanh",
      name: "Juan Herrera",
      email: "juan@gmail.com",
      is_active: true,
      type: "internal",
      path: "users",
      attributes: { payroll_user_id: "abc", payroll_role: "EMPLOYEE" },
    });
    expect(Object.keys(body)).not.toContain("password");
  });

  it("adds a user to a group by group uuid", async () => {
    const { impl, calls } = fakeFetch([{ status: 204, body: {} }]);
    await createAuthentikClient(CONFIG, impl).addUserToGroup("group-uuid-1", 12);
    expect(calls[0]!.url).toBe(
      "https://auth.example.test/api/v3/core/groups/group-uuid-1/add_user/",
    );
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ pk: 12 });
  });

  it("throws AuthentikApiError on a non-2xx, and never puts the token in the message", async () => {
    const { impl } = fakeFetch([{ status: 403, body: { detail: "forbidden" } }]);
    const client = createAuthentikClient(CONFIG, impl);
    await expect(client.findUserByEmail("x@y.com")).rejects.toBeInstanceOf(AuthentikApiError);
    await client.findUserByEmail("x@y.com").catch((err: AuthentikApiError) => {
      expect(err.status).toBe(403);
      expect(err.message).not.toContain("secret-token-value");
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/authentik/client.test.ts`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 3: Implement**

Create `lib/authentik/client.ts`:

```ts
// Authentik admin-API client.
//
// Scope is deliberately tiny and CREATE-ONLY: payroll may create a missing
// user and put it in the payroll group. It never updates or deletes an
// Authentik user — Authentik is the source of truth for profile identity, so
// writing back would fight it.
//
// Endpoints verified against the running instance's source (authentik
// core/api/users.py, core/api/groups.py):
//   GET  /core/users/?email=<email>        exact filter
//   GET  /core/users/?username=<username>  exact filter
//   POST /core/users/                      UserSerializer
//   GET  /core/groups/?name=<name>         exact filter
//   POST /core/groups/<uuid>/add_user/     body { pk }
//
// The token is never logged and never interpolated into an error message.

import { z } from "zod";

const REQUEST_TIMEOUT_MS = 10_000;

export class AuthentikApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AuthentikApiError";
  }
}

const akUserSchema = z.object({
  pk: z.number(),
  username: z.string(),
  name: z.string().default(""),
  email: z.string().default(""),
  is_active: z.boolean().default(true),
});
const akListSchema = z.object({ results: z.array(akUserSchema) });
const akGroupListSchema = z.object({
  results: z.array(z.object({ pk: z.string(), name: z.string() })),
});

export type AuthentikUser = {
  pk: number;
  username: string;
  name: string;
  email: string;
  isActive: boolean;
};
export type AuthentikGroup = { pk: string; name: string };

export type AuthentikClient = {
  findUserByEmail(email: string): Promise<AuthentikUser | null>;
  findUserByUsername(username: string): Promise<AuthentikUser | null>;
  createUser(input: {
    username: string;
    name: string;
    email: string;
    attributes: Record<string, unknown>;
  }): Promise<AuthentikUser>;
  findGroupByName(name: string): Promise<AuthentikGroup | null>;
  addUserToGroup(groupPk: string, userPk: number): Promise<void>;
};

export function readAuthentikConfig(): { apiUrl: string; token: string } | null {
  const apiUrl = process.env.AUTHENTIK_API_URL?.replace(/\/+$/, "");
  const token = process.env.AUTHENTIK_API_TOKEN;
  if (!apiUrl || !token) return null;
  return { apiUrl, token };
}

function toUser(raw: z.infer<typeof akUserSchema>): AuthentikUser {
  return {
    pk: raw.pk,
    username: raw.username,
    name: raw.name,
    email: raw.email,
    isActive: raw.is_active,
  };
}

export function createAuthentikClient(
  config: { apiUrl: string; token: string },
  fetchImpl: typeof fetch = fetch,
): AuthentikClient {
  async function request(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<unknown> {
    const url = `${config.apiUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      throw new AuthentikApiError(
        `${init?.method ?? "GET"} ${path} failed: ${err instanceof Error ? err.message : "network error"}`,
      );
    } finally {
      clearTimeout(timer);
    }
    const text = await resp.text();
    if (!resp.ok) {
      // Path only — never the URL with query values, never the token.
      throw new AuthentikApiError(
        `${init?.method ?? "GET"} ${path.split("?")[0]} -> ${resp.status} ${text.slice(0, 200)}`,
        resp.status,
      );
    }
    if (text.length === 0) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new AuthentikApiError(`${path.split("?")[0]}: response was not JSON.`);
    }
  }

  async function findOne(query: string): Promise<AuthentikUser | null> {
    const parsed = akListSchema.safeParse(await request(`/core/users/?${query}`));
    if (!parsed.success) throw new AuthentikApiError("Unexpected /core/users/ payload.");
    const first = parsed.data.results[0];
    return first ? toUser(first) : null;
  }

  return {
    findUserByEmail: (email) => findOne(`email=${encodeURIComponent(email)}`),
    findUserByUsername: (username) => findOne(`username=${encodeURIComponent(username)}`),

    async createUser(input) {
      const raw = await request("/core/users/", {
        method: "POST",
        body: {
          username: input.username,
          name: input.name,
          email: input.email,
          is_active: true,
          type: "internal",
          path: "users",
          attributes: input.attributes,
        },
      });
      const parsed = akUserSchema.safeParse(raw);
      if (!parsed.success) throw new AuthentikApiError("Unexpected create-user payload.");
      return toUser(parsed.data);
    },

    async findGroupByName(name) {
      const parsed = akGroupListSchema.safeParse(
        await request(`/core/groups/?name=${encodeURIComponent(name)}`),
      );
      if (!parsed.success) throw new AuthentikApiError("Unexpected /core/groups/ payload.");
      return parsed.data.results[0] ?? null;
    },

    async addUserToGroup(groupPk, userPk) {
      await request(`/core/groups/${encodeURIComponent(groupPk)}/add_user/`, {
        method: "POST",
        body: { pk: userPk },
      });
    },
  };
}

/** Null when the integration is not configured — every caller treats that as "do nothing". */
export function getAuthentikClient(): AuthentikClient | null {
  const config = readAuthentikConfig();
  return config ? createAuthentikClient(config) : null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/authentik/client.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/authentik/client.ts lib/authentik/client.test.ts
git commit -m "feat(authentik): create-only admin API client"
```

---

### Task 6: Provisioning service

**Files:**
- Create: `lib/authentik/provision.ts`
- Modify: `lib/settings/schemas.ts` (add `ssoSchema` + registry entry)

**Interfaces:**
- Consumes: `deriveAuthentikUsername`, `decideProvision`, `getAuthentikClient`, `AuthentikClient`, `linkAuthentikAccount`, `listUsersMissingAuthentik`, `getEmployee`, `getSetting`, `writeAudit`.
- Produces:
```ts
export type ProvisionOutcome =
  | { status: "created" | "linked"; userId: string; email: string; username: string; authentikPk: number }
  | { status: "skipped"; userId: string; email: string; reason: string }
  | { status: "needs-review"; userId: string; email: string; username: string; reason: string }
  | { status: "failed"; userId: string; email: string; error: string };
export async function provisionPayrollUser(userId: string, opts?: { client?: AuthentikClient; dryRun?: boolean }): Promise<ProvisionOutcome>;
export async function provisionMissingUsers(opts?: { dryRun?: boolean }): Promise<ProvisionOutcome[]>;
export async function provisionPayrollUserBestEffort(userId: string): Promise<void>;
```

- [ ] **Step 1: Add the `sso` settings key**

In `lib/settings/schemas.ts`, before the registry block:

```ts
// ─── SSO (Authentik) ─────────────────────────────────────────────────────────
// Authentik is the source of truth for display name and email. Payroll pushes
// missing users into it and never edits an existing Authentik account.

export const ssoSchema = z.object({
  autoProvision: z.boolean().default(true),
  groupName: z.string().min(1).max(120).default("payroll-users"),
  reconcileCron: z.string().min(1).max(120).default("0 3 * * *"),
});
export type SsoSettings = z.infer<typeof ssoSchema>;
```

And add to `settingsRegistry`, after `rolePermissions`:

```ts
  sso: ssoSchema,
```

- [ ] **Step 2: Write the provisioning service**

Create `lib/authentik/provision.ts`:

```ts
// Payroll -> Authentik provisioning.
//
// Idempotent and create-only. Every path is safe to re-run: an already-linked
// user is a no-op, an email match links without writing to the IdP, and an
// ambiguous username stops and reports instead of guessing.
//
// Failure is never fatal to the caller. A payroll user must be creatable when
// the IdP is down; the nightly reconcile picks up whatever was missed.

import { db } from "@/lib/db";
import { users, employees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { linkAuthentikAccount, listUsersMissingAuthentik } from "@/lib/db/queries/users";
import { getSetting } from "@/lib/settings/runtime";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";
import { deriveAuthentikUsername } from "./username";
import { decideProvision } from "./decide";
import { getAuthentikClient, type AuthentikClient } from "./client";

export type ProvisionOutcome =
  | {
      status: "created" | "linked";
      userId: string;
      email: string;
      username: string;
      authentikPk: number;
    }
  | { status: "skipped"; userId: string; email: string; reason: string }
  | { status: "needs-review"; userId: string; email: string; username: string; reason: string }
  | { status: "failed"; userId: string; email: string; error: string };

/** Name to give the IdP: the linked employee's preferred/display name, else the email local-part. */
async function displayNameFor(employeeId: string | null, email: string): Promise<string> {
  if (employeeId) {
    const [row] = await db
      .select({
        displayName: employees.displayName,
        preferredName: employees.preferredName,
      })
      .from(employees)
      .where(eq(employees.id, employeeId))
      .limit(1);
    const name = row?.preferredName?.trim() || row?.displayName?.trim();
    if (name) return name;
  }
  return email.split("@")[0] ?? email;
}

export async function provisionPayrollUser(
  userId: string,
  opts?: { client?: AuthentikClient; dryRun?: boolean },
): Promise<ProvisionOutcome> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { status: "failed", userId, email: "", error: "User not found." };

  const client = opts?.client ?? getAuthentikClient();
  if (!client) {
    return { status: "skipped", userId, email: user.email, reason: "not-configured" };
  }

  try {
    const name = await displayNameFor(user.employeeId, user.email);
    const candidateUsername = deriveAuthentikUsername({ name, email: user.email });
    const matchByEmail = await client.findUserByEmail(user.email);
    const usernameTaken =
      matchByEmail === null && (await client.findUserByUsername(candidateUsername)) !== null;

    const decision = decideProvision({
      alreadyLinked: user.authentikPk !== null,
      disabled: user.disabledAt !== null,
      email: user.email,
      candidateUsername,
      matchByEmail: matchByEmail ? { pk: matchByEmail.pk, username: matchByEmail.username } : null,
      usernameTaken,
    });

    if (decision.action === "skip") {
      return { status: "skipped", userId, email: user.email, reason: decision.reason };
    }
    if (decision.action === "needs-review") {
      return {
        status: "needs-review",
        userId,
        email: user.email,
        username: decision.username,
        reason: decision.reason,
      };
    }

    if (opts?.dryRun) {
      return {
        status: decision.action === "link" ? "linked" : "created",
        userId,
        email: user.email,
        username: decision.username,
        authentikPk: decision.action === "link" ? decision.authentikPk : -1,
      };
    }

    let authentikPk: number;
    if (decision.action === "link") {
      authentikPk = decision.authentikPk;
    } else {
      const created = await client.createUser({
        username: decision.username,
        name,
        email: user.email,
        attributes: { payroll_user_id: user.id, payroll_role: user.role },
      });
      authentikPk = created.pk;
    }

    // Group membership is best-effort on top of a successful create/link:
    // failing to add to the group must not lose the link we just made.
    const settings = await getSetting("sso").catch(() => null);
    const groupName = settings?.groupName ?? "payroll-users";
    try {
      const group = await client.findGroupByName(groupName);
      if (group) await client.addUserToGroup(group.pk, authentikPk);
      else logger.warn({ groupName }, "authentik: group not found; membership skipped");
    } catch (err) {
      logger.warn({ err, groupName }, "authentik: group membership failed");
    }

    await linkAuthentikAccount(userId, { pk: authentikPk, username: decision.username });
    await writeAudit({
      actorId: null,
      actorRole: null,
      action: decision.action === "link" ? "authentik.user.linked" : "authentik.user.provisioned",
      targetType: "User",
      targetId: userId,
      after: { authentikPk, username: decision.username, email: user.email },
    });

    return {
      status: decision.action === "link" ? "linked" : "created",
      userId,
      email: user.email,
      username: decision.username,
      authentikPk,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.warn({ err, userId }, "authentik: provisioning failed");
    await writeAudit({
      actorId: null,
      actorRole: null,
      action: "authentik.sync.failed",
      targetType: "User",
      targetId: userId,
      after: { error: message },
    }).catch(() => undefined);
    return { status: "failed", userId, email: user.email, error: message };
  }
}

/** Sweep every enabled user with no Authentik link. `dryRun` writes nothing. */
export async function provisionMissingUsers(opts?: {
  dryRun?: boolean;
}): Promise<ProvisionOutcome[]> {
  const settings = await getSetting("sso").catch(() => null);
  if (!opts?.dryRun && settings?.autoProvision === false) return [];

  const missing = await listUsersMissingAuthentik();
  const outcomes: ProvisionOutcome[] = [];
  for (const user of missing) {
    outcomes.push(
      await provisionPayrollUser(user.id, {
        ...(opts?.dryRun ? { dryRun: true } : {}),
      }),
    );
  }
  return outcomes;
}

/**
 * Fire-and-forget push used at user-creation call sites. Never throws, never
 * blocks: creating a payroll user must succeed even with the IdP unreachable.
 */
export async function provisionPayrollUserBestEffort(userId: string): Promise<void> {
  try {
    const settings = await getSetting("sso").catch(() => null);
    if (settings?.autoProvision === false) return;
    await provisionPayrollUser(userId);
  } catch (err) {
    logger.warn({ err, userId }, "authentik: best-effort provisioning failed");
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the whole unit suite**

Run: `npm run test`
Expected: PASS, including the three new pure-logic suites.

- [ ] **Step 5: Commit**

```bash
git add lib/authentik/provision.ts lib/settings/schemas.ts
git commit -m "feat(authentik): idempotent provisioning service and sso settings key"
```

---

### Task 7: Push on user creation

**Files:**
- Modify: `lib/db/queries/users.ts` (`createStaffUser`, `inviteEmployeeUser`)
- Modify: `app/(auth)/setup/actions.ts` (`createOwner`)

**Interfaces:**
- Consumes: `provisionPayrollUserBestEffort(userId: string): Promise<void>`.
- Produces: no new exports; behavior only.

- [ ] **Step 1: Wire `createStaffUser`**

In `lib/db/queries/users.ts`, immediately after the `writeAudit` call in `createStaffUser` and before `return { user: row, tempPassword: tempPlain }`:

```ts
  // Best-effort IdP push. Import lazily so this query module stays usable in
  // scripts and tests that never touch Authentik.
  const { provisionPayrollUserBestEffort } = await import("@/lib/authentik/provision");
  await provisionPayrollUserBestEffort(row.id);
```

- [ ] **Step 2: Wire `inviteEmployeeUser`**

Same two lines immediately before each `return` that hands back a user in `inviteEmployeeUser` — both the "already existed, password reset" branch (use `existingByEmployee.id`) and the fresh-insert branch (use `row.id`).

- [ ] **Step 3: Wire owner setup**

In `app/(auth)/setup/actions.ts`, after the `createUser` try/catch block and before `setSetting("company", ...)`:

```ts
  const { provisionPayrollUserBestEffort } = await import("@/lib/authentik/provision");
  await provisionPayrollUserBestEffort(user.id);
```

- [ ] **Step 4: Verify it cannot break user creation**

Read back each call site and confirm: the call is `await`ed but wrapped inside `provisionPayrollUserBestEffort`, which swallows every error. No call site adds a `try`/`catch` of its own, and none of them changes its return value.

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries/users.ts "app/(auth)/setup/actions.ts"
git commit -m "feat(authentik): push new payroll users to the IdP, best-effort"
```

---

### Task 8: Nightly reconcile job

**Files:**
- Create: `lib/jobs/handlers/authentik-reconcile.ts`
- Modify: `lib/jobs/index.ts`

**Interfaces:**
- Consumes: `provisionMissingUsers`, `getSetting`, `logger`.
- Produces: `AUTHENTIK_RECONCILE_QUEUE = "authentik.reconcile"`; `handleAuthentikReconcile(): Promise<void>`.

- [ ] **Step 1: Write the handler**

Create `lib/jobs/handlers/authentik-reconcile.ts`:

```ts
// Nightly Authentik reconcile.
//
// Self-heals anything the best-effort push at user-creation time missed: a
// failed push, an IdP outage, or a user created before SSO provisioning
// existed. Idempotent — a run with nothing to do writes nothing.

import { logger } from "@/lib/telemetry";
import { provisionMissingUsers } from "@/lib/authentik/provision";
import { readAuthentikConfig } from "@/lib/authentik/client";

export const AUTHENTIK_RECONCILE_QUEUE = "authentik.reconcile";

export async function handleAuthentikReconcile(): Promise<void> {
  if (!readAuthentikConfig()) {
    logger.debug("authentik reconcile: not configured, skipping");
    return;
  }
  const outcomes = await provisionMissingUsers();
  const tally = outcomes.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  logger.info({ tally, total: outcomes.length }, "authentik reconcile complete");

  const review = outcomes.filter((o) => o.status === "needs-review");
  if (review.length > 0) {
    logger.warn(
      { users: review.map((o) => o.email) },
      "authentik reconcile: accounts need a human decision",
    );
  }
}
```

- [ ] **Step 2: Register the queue and cron**

In `lib/jobs/index.ts`, add the import beside the other handler imports:

```ts
import {
  AUTHENTIK_RECONCILE_QUEUE,
  handleAuthentikReconcile,
} from "./handlers/authentik-reconcile";
```

And inside `registerJobs`, after the `period.rollover` block:

```ts
  await boss.createQueue(AUTHENTIK_RECONCILE_QUEUE);
  await boss.work(AUTHENTIK_RECONCILE_QUEUE, async () => {
    await handleAuthentikReconcile();
  });
  const sso = await getSetting("sso").catch(() => null);
  if (cronEnabled && sso?.autoProvision !== false) {
    await boss.schedule(
      AUTHENTIK_RECONCILE_QUEUE,
      sso?.reconcileCron ?? "0 3 * * *",
      undefined,
      tzOpts,
    );
  } else {
    await boss.unschedule(AUTHENTIK_RECONCILE_QUEUE).catch(() => undefined);
  }
```

Also add `//   • authentik.reconcile — nightly IdP provisioning sweep` to the job list in the file's header comment.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/jobs/handlers/authentik-reconcile.ts lib/jobs/index.ts
git commit -m "feat(authentik): nightly reconcile job for unlinked payroll users"
```

---

### Task 9: Sign-in resolution and profile merge

**Files:**
- Modify: `lib/auth.ts` (`signIn` and `jwt` callbacks)
- Create: `lib/authentik/sign-in.ts`

**Interfaces:**
- Consumes: `computeProfileMerge`, `findUserByAuthentikSub`, `findUserByEmail`, `linkAuthentikAccount`, `applyAuthentikProfile`, `setEmployeeDisplayName`, `writeAudit`.
- Produces: `resolveAuthentikSignIn(input: { sub: string | null; email: string | null; name: string | null }): Promise<{ user: User } | { rejected: "no-payroll-user" | "disabled" | "no-identity" }>`

Putting this in its own module keeps `lib/auth.ts` readable and means the callback does no branching of its own.

- [ ] **Step 1: Write the resolver**

Create `lib/authentik/sign-in.ts`:

```ts
// Resolve an Authentik OIDC identity to a payroll user, then let Authentik's
// profile win.
//
// Resolution order is sub, then email. The sub is written on the first
// successful email match and used forever after, so an email change on either
// side cannot orphan the account.
//
// Payroll stays the source of truth for role, employee linkage, pay, and
// enabled/disabled. This function never creates a payroll user: an Authentik
// identity with no payroll account is refused.

import type { User } from "@/lib/db/schema";
import {
  findUserByAuthentikSub,
  findUserByEmail,
  linkAuthentikAccount,
  applyAuthentikProfile,
  findUserById,
} from "@/lib/db/queries/users";
import { setEmployeeDisplayName } from "@/lib/db/queries/employees";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";
import { computeProfileMerge } from "./merge";

export type SignInResolution =
  | { user: User }
  | { rejected: "no-payroll-user" | "disabled" | "no-identity" };

export async function resolveAuthentikSignIn(input: {
  sub: string | null;
  email: string | null;
  name: string | null;
}): Promise<SignInResolution> {
  const sub = input.sub?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  if (sub.length === 0 && email.length === 0) return { rejected: "no-identity" };

  let user = sub.length > 0 ? await findUserByAuthentikSub(sub) : null;
  if (!user && email.length > 0) user = await findUserByEmail(email);
  if (!user) return { rejected: "no-payroll-user" };
  if (user.disabledAt) return { rejected: "disabled" };

  // First successful login for this identity: record the durable key, so
  // every later login resolves by sub and an email change cannot orphan it.
  if (sub.length > 0 && user.authentikSub !== sub) {
    await linkAuthentikAccount(user.id, { sub });
  }

  // Does another payroll user already hold the incoming email?
  const emailOwner = email.length > 0 ? await findUserByEmail(email) : null;
  const merge = computeProfileMerge({
    payrollEmail: user.email,
    payrollDisplayName: null, // resolved below only if there is a name to apply
    idpEmail: email,
    idpName: input.name,
    emailTakenByAnotherUser: emailOwner !== null && emailOwner.id !== user.id,
  });

  if (merge.conflicts.length > 0) {
    logger.warn(
      { userId: user.id, conflicts: merge.conflicts },
      "authentik: profile merge conflict, login admitted unchanged",
    );
    await writeAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "authentik.merge.conflict",
      targetType: "User",
      targetId: user.id,
      after: { conflicts: merge.conflicts },
    });
  }

  if (merge.email) {
    await applyAuthentikProfile(user.id, { email: merge.email.to });
    await writeAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "authentik.merge.applied",
      targetType: "User",
      targetId: user.id,
      before: { email: merge.email.from },
      after: { email: merge.email.to },
    });
  }

  if (merge.displayName && user.employeeId) {
    await setEmployeeDisplayName(user.employeeId, merge.displayName.to);
    await writeAudit({
      actorId: user.id,
      actorRole: user.role,
      action: "authentik.merge.applied",
      targetType: "Employee",
      targetId: user.employeeId,
      after: { displayName: merge.displayName.to },
    });
  }

  const refreshed = (await findUserById(user.id)) ?? user;
  return { user: refreshed };
}
```

Note: `computeProfileMerge` is called with `payrollDisplayName: null` so a non-empty IdP name always proposes a change; `setEmployeeDisplayName` is idempotent, and the audit row records what was applied. If you prefer to suppress no-op name writes, fetch the employee's current `displayName` first and pass it — behavior is identical apart from one fewer audit row.

- [ ] **Step 2: Use it in `lib/auth.ts`**

Replace the `signIn` callback's authentik branch:

```ts
    async signIn({ user, account, profile }) {
      if (account?.provider === "authentik") {
        const { resolveAuthentikSignIn } = await import("@/lib/authentik/sign-in");
        const resolved = await resolveAuthentikSignIn({
          sub: (profile?.sub as string | undefined) ?? account.providerAccountId ?? null,
          email: user.email ?? null,
          name: (profile?.name as string | undefined) ?? user.name ?? null,
        });
        return "user" in resolved;
      }
      return true;
    },
```

And the authentik branch of the `jwt` callback:

```ts
        if (account?.provider === "authentik") {
          // resolveAuthentikSignIn already ran in the signIn callback and
          // applied the merge; re-resolving here only reads the row back.
          const { resolveAuthentikSignIn } = await import("@/lib/authentik/sign-in");
          const resolved = await resolveAuthentikSignIn({
            sub: (account.providerAccountId as string | undefined) ?? null,
            email: user.email ?? null,
            name: user.name ?? null,
          });
          if ("user" in resolved) {
            const dbUser = resolved.user;
            token.id = dbUser.id;
            token.role = dbUser.role;
            token.employeeId = dbUser.employeeId ?? undefined;
            token.mustChangePassword = dbUser.mustChangePassword;
          }
        } else {
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `profile` is not in the `signIn` callback's parameter type for this Auth.js version, fall back to `account.providerAccountId` for the sub and `user.name` for the name — both are populated for OIDC providers.

- [ ] **Step 4: Run the suite**

Run: `npm run test && npm run lint`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/authentik/sign-in.ts
git commit -m "feat(auth): resolve SSO logins by subject, let Authentik own name and email"
```

---

### Task 10: Login UX — committed SSO button and a real denial message

**Files:**
- Create: `app/(auth)/login/sso-sign-in-form.tsx` (exists untracked on LX120; this brings it into version control)
- Modify: `app/(auth)/login/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<SsoSignInForm callbackUrl={string} />`

- [ ] **Step 1: Create the component**

Create `app/(auth)/login/sso-sign-in-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Auth.js OAuth sign-in via POST + CSRF.
 *
 * The server-action form this replaces was unreliable on the first click:
 * the action redirect raced the client router and the button appeared dead
 * until a second press. Posting the CSRF token straight to the provider
 * endpoint is the documented path and works first time.
 */
export function SsoSignInForm({ callbackUrl }: { callbackUrl: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startSso() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/csrf", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Could not start SSO");
      const { csrfToken } = (await res.json()) as { csrfToken: string };

      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/auth/signin/authentik";

      for (const [name, value] of [
        ["csrfToken", csrfToken],
        ["callbackUrl", callbackUrl],
      ] as const) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }

      document.body.appendChild(form);
      form.submit();
    } catch {
      setLoading(false);
      setError("Could not start SSO. Please try again.");
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="lg" className="w-full" disabled={loading} onClick={startSso}>
        {loading ? "Redirecting..." : "Sign in with SSO"}
      </Button>
      {error ? <p className="text-center text-xs text-danger-700">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Use it and add the denial message**

In `app/(auth)/login/page.tsx`: widen the searchParams type, import the component, drop the inline server-action form, and render the error.

```tsx
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
```

```tsx
  const { from, error } = await searchParams;
```

Replace the `oidcEnabled && (...)` form block with:

```tsx
        {oidcEnabled && (
          <>
            {error === "AccessDenied" && (
              <div className="rounded-input border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-800">
                That account is not set up in payroll yet. Ask the office to add you.
              </div>
            )}
            <SsoSignInForm callbackUrl={from || "/"} />
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <hr className="flex-1" />
              <span>or sign in with email</span>
              <hr className="flex-1" />
            </div>
          </>
        )}
```

Add `import { SsoSignInForm } from "./sso-sign-in-form";` and remove the now-unused `signIn` and `Button` imports if nothing else on the page uses them.

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean. If `danger-50` / `danger-200` / `danger-800` are not defined in `app/globals.css`, use the nearest defined steps from the `--color-danger-*` ramp — never an undefined token (a past bug rendered invisible elements exactly this way).

- [ ] **Step 4: Commit**

```bash
git add "app/(auth)/login/sso-sign-in-form.tsx" "app/(auth)/login/page.tsx"
git commit -m "fix(auth): commit the POST+CSRF SSO button and explain an SSO denial

The component was written by hand on LX120 and never version-controlled.
A rejected SSO identity now gets plain English instead of Auth.js's
generic AccessDenied."
```

---

### Task 11: Settings page — lever, missing list, Preview sync

**Files:**
- Create: `app/(admin)/settings/sso/page.tsx`
- Create: `app/(admin)/settings/sso/actions.ts`
- Create: `app/(admin)/settings/sso/sso-form.tsx`
- Create: `app/(admin)/settings/sso/loading.tsx`
- Modify: `app/(admin)/settings/settings-nav.tsx`

**Interfaces:**
- Consumes: `getSetting`, `setSetting`, `provisionMissingUsers`, `listUsersMissingAuthentik`, `readAuthentikConfig`, `requireAdmin`.
- Produces: server actions `saveSsoSettings(formData: FormData)`, `previewSsoSyncAction()`, `runSsoReconcileAction()`.

- [ ] **Step 1: Write the actions**

Create `app/(admin)/settings/sso/actions.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-guards";
import { setSetting } from "@/lib/settings/runtime";
import { writeAudit } from "@/lib/db/audit";
import { provisionMissingUsers, type ProvisionOutcome } from "@/lib/authentik/provision";

const formSchema = z.object({
  autoProvision: z.union([z.literal("on"), z.literal(undefined)]).optional(),
  groupName: z.string().min(1).max(120),
  reconcileCron: z.string().min(1).max(120),
});

export async function saveSsoSettings(
  formData: FormData,
): Promise<{ error?: string } | void> {
  const session = await requireAdmin();
  const parsed = formSchema.safeParse({
    autoProvision: formData.get("autoProvision") ?? undefined,
    groupName: formData.get("groupName"),
    reconcileCron: formData.get("reconcileCron"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  await setSetting("sso", {
    autoProvision: parsed.data.autoProvision === "on",
    groupName: parsed.data.groupName,
    reconcileCron: parsed.data.reconcileCron,
  });
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "settings.sso.update",
    targetType: "Setting",
    targetId: "sso",
    after: {
      autoProvision: parsed.data.autoProvision === "on",
      groupName: parsed.data.groupName,
      reconcileCron: parsed.data.reconcileCron,
    },
  });
  revalidatePath("/settings/sso");
}

/** Dry run: reports what a sync WOULD do. Writes nothing, anywhere. */
export async function previewSsoSyncAction(): Promise<{ outcomes: ProvisionOutcome[] }> {
  await requireAdmin();
  return { outcomes: await provisionMissingUsers({ dryRun: true }) };
}

export async function runSsoReconcileAction(): Promise<{ outcomes: ProvisionOutcome[] }> {
  const session = await requireAdmin();
  const outcomes = await provisionMissingUsers();
  await writeAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: "authentik.sync.manual",
    targetType: "Setting",
    targetId: "sso",
    after: { count: outcomes.length },
  });
  revalidatePath("/settings/sso");
  return { outcomes };
}
```

- [ ] **Step 2: Write the page**

Create `app/(admin)/settings/sso/page.tsx`:

```tsx
import { getSetting } from "@/lib/settings/runtime";
import { listUsersMissingAuthentik } from "@/lib/db/queries/users";
import { readAuthentikConfig } from "@/lib/authentik/client";
import { SsoForm } from "./sso-form";

export default async function Page() {
  const settings = await getSetting("sso");
  const missing = await listUsersMissingAuthentik();
  return (
    <SsoForm
      settings={settings}
      configured={readAuthentikConfig() !== null}
      missing={missing.map((u) => ({ id: u.id, email: u.email, role: u.role }))}
    />
  );
}
```

Create `app/(admin)/settings/sso/loading.tsx` mirroring `app/(admin)/settings/security/loading.tsx` exactly (copy that file; every admin route has a skeleton).

- [ ] **Step 3: Write the form**

Create `app/(admin)/settings/sso/sso-form.tsx` as a client component with:
- A `Card` titled "Single sign-on (Authentik)".
- When `configured` is false, a warning row: "AUTHENTIK_API_URL and AUTHENTIK_API_TOKEN are not set on this server. Provisioning is inactive." and the action buttons disabled.
- A checkbox `autoProvision`, text input `groupName`, text input `reconcileCron`, and a Save button posting to `saveSsoSettings`.
- A second Card "Accounts not yet in Authentik" listing `missing` (email + role), or an empty state reading "Every enabled payroll user has an Authentik account."
- Two buttons: "Preview sync" (calls `previewSsoSyncAction`, renders the returned outcomes in a table: email, result, username, reason) and "Run sync now" (calls `runSsoReconcileAction`). Keep the results in `useState`; no emoji; follow the existing form components in `app/(admin)/settings/security/security-form.tsx` for markup and class conventions.

- [ ] **Step 4: Add the nav entry**

In `app/(admin)/settings/settings-nav.tsx`, import `KeySquare` from `lucide-react` and add to `CONFIG_TABS` directly after the Security entry:

```ts
  { href: "/settings/sso", label: "Single sign-on", icon: KeySquare },
```

- [ ] **Step 5: Typecheck, lint, and eyeball it**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/settings/sso" "app/(admin)/settings/settings-nav.tsx"
git commit -m "feat(settings): single sign-on page with a dry-run preview"
```

---

### Task 12: Authentik-side setup on LXC 111

**Files:** none in the repo except `docker-compose.yml`.

**Interfaces:**
- Consumes: nothing.
- Produces: `AUTHENTIK_API_URL` and `AUTHENTIK_API_TOKEN` present in `/etc/payroll/.env` on LX120 and passed into the container.

This task touches live infrastructure. Every command is read-only or additive; nothing here deletes or modifies an existing Authentik object.

- [ ] **Step 1: Create the service account and token**

The Authentik management shell needs `HOME` pointed at `/opt/authentik` — without it `uv` dies with `Failed to initialize cache at /root/.cache/uv`. The invocation below was run read-only against LXC 111 on 2026-09-15 and works. Scripts are pushed as files and fed on stdin so nothing has to survive three levels of shell quoting.

```bash
ssh root@192.168.1.190 'bash -s' <<'OUTER'
set -euo pipefail

cat > /tmp/ak-provision-setup.py <<'PY'
from authentik.core.models import Token, TokenIntents, User, UserTypes
from django.contrib.auth.models import Permission

user, created = User.objects.get_or_create(
    username="svc-payroll-provisioning",
    defaults={
        "name": "Payroll provisioning",
        "type": UserTypes.SERVICE_ACCOUNT,
        "attributes": {"managed_by": "payroll"},
    },
)
perms = Permission.objects.filter(
    content_type__app_label="authentik_core",
    codename__in=["view_user", "add_user", "view_group", "add_user_to_group"],
)
user.user_permissions.set(list(perms))
user.save()

token, t_created = Token.objects.get_or_create(
    identifier="payroll-provisioning",
    defaults={
        "user": user,
        "intent": TokenIntents.INTENT_API,
        "expiring": False,
        "description": "Payroll app user provisioning",
    },
)
print("service_account_created:", created)
print("token_created:", t_created)
print("permissions:", sorted(p.codename for p in user.user_permissions.all()))
PY

chmod 644 /tmp/ak-provision-setup.py
pct push 111 /tmp/ak-provision-setup.py /tmp/ak-provision-setup.py
pct exec 111 -- bash -c 'cd /opt/authentik && set -a; . /etc/default/authentik 2>/dev/null; set +a; sudo -u authentik -H env HOME=/opt/authentik /usr/local/bin/uv run python -m manage shell < /tmp/ak-provision-setup.py' | tail -4
rm -f /tmp/ak-provision-setup.py
OUTER
```

Expected, on the last lines of output:
```
service_account_created: True
token_created: True
permissions: ['add_user', 'add_user_to_group', 'view_group', 'view_user']
```

All four codenames must be present. This step never prints the token key.

- [ ] **Step 2: Move the token key into the payroll env file without printing it**

The key moves container-to-container inside one remote shell. It is never echoed, never written to a repo file, and never pasted into chat.

```bash
ssh root@192.168.1.190 'bash -s' <<'OUTER'
set -euo pipefail

cat > /tmp/ak-print-token.py <<'PY'
from authentik.core.models import Token
print(Token.objects.get(identifier="payroll-provisioning").key)
PY
chmod 644 /tmp/ak-print-token.py
pct push 111 /tmp/ak-print-token.py /tmp/ak-print-token.py

# The shell banner and Django's import notice go to stdout too, so take the
# last line only.
KEY=$(pct exec 111 -- bash -c 'cd /opt/authentik && set -a; . /etc/default/authentik 2>/dev/null; set +a; sudo -u authentik -H env HOME=/opt/authentik /usr/local/bin/uv run python -m manage shell < /tmp/ak-print-token.py' | tr -d '\r' | tail -1)
rm -f /tmp/ak-print-token.py
pct exec 111 -- rm -f /tmp/ak-print-token.py

if [ ${#KEY} -lt 20 ]; then echo "FAILED: no token key captured"; exit 1; fi

pct exec 120 -- bash -c "
  sed -i '/^AUTHENTIK_API_URL=/d;/^AUTHENTIK_API_TOKEN=/d' /etc/payroll/.env
  printf 'AUTHENTIK_API_URL=https://auth.booute.duckdns.org/api/v3\nAUTHENTIK_API_TOKEN=%s\n' '$KEY' >> /etc/payroll/.env
  chmod 600 /etc/payroll/.env
  grep -c '^AUTHENTIK_API' /etc/payroll/.env
"
OUTER
```

Expected final line: `2`.

Confirm the value landed without revealing it:

```bash
ssh root@192.168.1.190 "pct exec 120 -- bash -c \"awk -F= '/^AUTHENTIK_API_TOKEN/ {print \\\$1\"=\"length(\\\$2)\" chars\"}' /etc/payroll/.env\""
```
Expected: `AUTHENTIK_API_TOKEN=<some length> chars`, typically 60 or more.

- [ ] **Step 3: Pass the variables into the container**

In `docker-compose.yml`, in the `app` service `environment` block beside the existing `AUTHENTIK_*` lines:

```yaml
      AUTHENTIK_API_URL: ${AUTHENTIK_API_URL:-}
      AUTHENTIK_API_TOKEN: ${AUTHENTIK_API_TOKEN:-}
```

- [ ] **Step 4: Smoke-test the token from LX120**

```bash
ssh root@192.168.1.190 'pct exec 120 -- bash -lc "set -a; . /etc/payroll/.env; set +a; curl -s -o /dev/null -w \"%{http_code}\n\" -H \"Authorization: Bearer \$AUTHENTIK_API_TOKEN\" \"\$AUTHENTIK_API_URL/core/users/?username=akadmin\""'
```

Expected: `200`. A `403` means the permission grant did not take — re-run Step 1 and check the printed permission list. Do not proceed past a non-200.

- [ ] **Step 5: Confirm the redirect URI matches the live app URL**

```bash
ssh root@192.168.1.190 'pct exec 120 -- bash -lc "grep ^APP_URL /etc/payroll/.env"'
```

The provider's registered redirect URI is `https://digitz.duckdns.org/api/auth/callback/authentik` (strict). If `APP_URL` is not `https://digitz.duckdns.org`, stop and report — SSO will fail at the callback and the fix is an Authentik-side provider edit, which is outside this task's additive-only scope.

- [ ] **Step 6: Commit the compose change**

```bash
git add docker-compose.yml
git commit -m "chore(deploy): pass Authentik admin API config into the app container"
```

---

### Task 13: Deploy, preview, then live sync and verification

**Files:**
- Modify: `docs/sso-user-mapping.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Merge the feature branch and deploy**

```bash
npm run typecheck && npm run lint && npm run test
git checkout rebuild/foundation
git merge --no-ff feat/authentik-sso -m "feat(auth): Authentik SSO provisioning and profile merge"
./deploy.sh
```
Expected: `deploy.sh` reports the target SHA live and the health check passing.

- [ ] **Step 2: Apply the migration on LX120**

```bash
ssh root@192.168.1.190 'pct exec 120 -- bash -lc "cd /opt/payroll && docker compose exec -T app node -e \"process.exit(0)\" && docker compose run --rm app npm run db:migrate"'
```
Expected: the `0048` migration applies. Then confirm:
```bash
ssh root@192.168.1.190 'pct exec 120 -- bash -lc "cd /opt/payroll && docker compose exec -T db psql -U payroll -d payroll -c \"\\d users\" | grep authentik"'
```
Expected: four columns present. If the deploy pipeline already runs migrations on boot, this step is a no-op confirmation.

- [ ] **Step 3: Preview the sync and show the owner**

Open `/settings/sso` in the app, press **Preview sync**, and capture the table. Expected: roughly 9-16 rows across `created` / `linked`, possibly a few `needs-review`. Post the list to the owner and wait for a go-ahead before Step 4. Nothing has been written to Authentik at this point.

- [ ] **Step 4: Run the live sync**

Press **Run sync now**. Then verify from the Authentik side:

```bash
ssh root@192.168.1.190 'pct exec 111 -- bash -lc "su postgres -c \"psql -d authentik -At -c \\\"select username, email, type from authentik_core_user where attributes ? '"'"'payroll_user_id'"'"' order by username\\\"\""'
```
Expected: one row per newly created account, all `type = internal`, emails matching payroll.

And confirm group membership:
```bash
ssh root@192.168.1.190 'pct exec 111 -- bash -lc "su postgres -c \"psql -d authentik -At -c \\\"select u.username from authentik_core_user_groups m join authentik_core_user u on u.id=m.user_id join authentik_core_group g on g.group_uuid=m.group_id where g.name='"'"'payroll-users'"'"' order by u.username\\\"\""'
```
Expected: the previous three members plus every provisioned account.

- [ ] **Step 5: Verify idempotency**

Press **Run sync now** a second time. Expected: every row reports `skipped / already-linked`, and no new `authentik_core_user` rows appear. Re-run the query from Step 4 and compare the count.

- [ ] **Step 6: End-to-end login checks**

1. Sign in with SSO as a staff account. Expected: lands in the app with the correct role.
2. Check the audit log at `/audit` for `authentik.merge.applied` (only if a name or email actually differed) and no `authentik.merge.conflict`.
3. Sign in again with the same account. Expected: no new merge audit rows — the merge is idempotent.
4. Sign in as an employee with email + password. Expected: unchanged.
5. Sign in at `/kiosk` with a clock ID and PIN. Expected: unchanged.
6. Visit `/login?error=AccessDenied`. Expected: the plain-English denial message, not a generic Auth.js error.

- [ ] **Step 7: Bind the group policy (as approved in the spec)**

```bash
ssh root@192.168.1.190 'bash -s' <<'OUTER'
set -euo pipefail

cat > /tmp/ak-bind-payroll.py <<'PY'
from authentik.core.models import Application, Group
from authentik.policies.models import PolicyBinding

app = Application.objects.get(slug="payroll")
group = Group.objects.get(name="payroll-users")
binding, created = PolicyBinding.objects.get_or_create(
    target=app, group=group, defaults={"order": 0, "enabled": True}
)
print("binding_created:", created, "enabled:", binding.enabled)
PY

chmod 644 /tmp/ak-bind-payroll.py
pct push 111 /tmp/ak-bind-payroll.py /tmp/ak-bind-payroll.py
pct exec 111 -- bash -c 'cd /opt/authentik && set -a; . /etc/default/authentik 2>/dev/null; set +a; sudo -u authentik -H env HOME=/opt/authentik /usr/local/bin/uv run python -m manage shell < /tmp/ak-bind-payroll.py' | tail -2
rm -f /tmp/ak-bind-payroll.py
pct exec 111 -- rm -f /tmp/ak-bind-payroll.py
OUTER
```
Expected: `binding_created: True enabled: True`. Immediately re-run the SSO login from Step 6.1 to confirm access still works. If it breaks, set `binding.enabled = False` and report — do not leave the owner locked out.

- [ ] **Step 8: Update the docs**

Rewrite `docs/sso-user-mapping.md`: the hand-maintained mapping table is now generated behavior, so replace it with how provisioning works, what Authentik owns (name + email) versus what payroll owns, the `needs-review` case and how to resolve it (set the email in Authentik, wait for the nightly reconcile or press Run sync now), where the API token lives, and the nightly cron.

Add a bullet to the "Current status" section of `CLAUDE.md` describing this feature: link columns, create-only provisioning, `decideProvision`'s refusal to match on username and why, the login-time merge with its email-conflict guard, the `sso` settings key, the reconcile job, and the `payroll-users` policy binding.

- [ ] **Step 9: Commit and deploy the docs**

```bash
git add docs/sso-user-mapping.md CLAUDE.md
git commit -m "docs: Authentik SSO provisioning and profile merge"
./deploy.sh
```

- [ ] **Step 10: Report**

Report to the owner: how many accounts were created versus linked, any `needs-review` rows and what to do about them, confirmation that employee password login and kiosk PIN still work, and confirmation that the second sync was a no-op.
