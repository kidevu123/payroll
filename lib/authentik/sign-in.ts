// Resolve an Authentik OIDC identity to a payroll user, then let Authentik's
// profile win.
//
// Resolution order is sub, then email. Email is a ONE-TIME BOOTSTRAP for the
// link: the sub is written only the first time it is genuinely empty. Once a
// payroll user has a bound authentik_sub, only that exact sub can resolve the
// account again — a login whose sub differs from an existing binding is
// refused outright, even if its email matches. Without that refusal, anyone
// who can set their own IdP email to a payroll user's address could steal
// that account (role, employee linkage, pay) out from under its real owner.
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
  recordSuccessfulLogin,
} from "@/lib/db/queries/users";
import { getEmployee, setEmployeeDisplayName } from "@/lib/db/queries/employees";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";
import { computeProfileMerge } from "./merge";

export type SignInResolution =
  | { user: User }
  | { rejected: "no-payroll-user" | "disabled" | "no-identity" | "sub-mismatch" };

// Internal to this module: the read-only resolver needs to carry the
// mismatched user's id out of a rejection so the writing wrapper below can
// audit it, without the resolver itself doing any writes. SignInResolution
// (the public return type) drops that id once the audit row has been
// written — callers outside this module never see it.
type IdentityResolution =
  | { user: User }
  | { rejected: "no-payroll-user" | "disabled" | "no-identity" }
  | { rejected: "sub-mismatch"; userId: string };

/**
 * Resolve an Authentik identity to a payroll user. Read-only: no links, no
 * merges, no audit rows. The jwt callback uses this, because it runs on
 * every token refresh and must not repeat the sign-in side effects.
 */
export async function resolveAuthentikIdentity(input: {
  sub: string | null;
  email: string | null;
}): Promise<IdentityResolution> {
  const sub = input.sub?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  if (sub.length === 0 && email.length === 0) return { rejected: "no-identity" };

  let user = sub.length > 0 ? await findUserByAuthentikSub(sub) : null;
  const resolvedBySub = user !== null;
  if (!user && email.length > 0) user = await findUserByEmail(email);
  if (!user) return { rejected: "no-payroll-user" };
  if (user.disabledAt) return { rejected: "disabled" };

  // Reached this user via email, but it already has a DIFFERENT sub bound.
  // Email is only the bootstrap path; once a subject is bound, that subject
  // is the only key that resolves this account. Letting an email match win
  // here would let a second Authentik identity steal a bound payroll
  // account by claiming its email address.
  if (
    !resolvedBySub &&
    sub.length > 0 &&
    user.authentikSub !== null &&
    user.authentikSub !== sub
  ) {
    return { rejected: "sub-mismatch", userId: user.id };
  }

  return { user };
}

export async function resolveAuthentikSignIn(input: {
  sub: string | null;
  email: string | null;
  name: string | null;
}): Promise<SignInResolution> {
  const identity = await resolveAuthentikIdentity({ sub: input.sub, email: input.email });

  if (!("user" in identity)) {
    if (identity.rejected === "sub-mismatch") {
      logger.warn(
        { userId: identity.userId },
        "authentik: sign-in subject does not match the bound account, login refused",
      );
      await writeAudit({
        actorId: null,
        actorRole: null,
        action: "authentik.link.conflict",
        targetType: "User",
        targetId: identity.userId,
      });
      return { rejected: "sub-mismatch" };
    }
    return identity;
  }

  const user = identity.user;
  const sub = input.sub?.trim() ?? "";
  const email = input.email?.trim() ?? "";

  // Bootstrap only: bind the subject the first time it is genuinely empty.
  // Never overwrite an existing binding here — resolveAuthentikIdentity
  // above already refused any sub that conflicts with one.
  if (sub.length > 0 && user.authentikSub === null) {
    await linkAuthentikAccount(user.id, { sub });
  }

  // Does another payroll user already hold the incoming email?
  const emailOwner = email.length > 0 ? await findUserByEmail(email) : null;

  // Compare against the name we would actually overwrite, so a login that
  // changes nothing writes no audit row (spec: merges are recorded, no-ops
  // are not).
  let currentDisplayName: string | null = null;
  if (user.employeeId) {
    const employee = await getEmployee(user.employeeId);
    currentDisplayName = employee?.displayName ?? null;
  }

  const merge = computeProfileMerge({
    payrollEmail: user.email,
    payrollDisplayName: currentDisplayName,
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

  // Parity with the credentials path (lib/auth.ts, Credentials authorize):
  // record the login so lastLoginAt, the audit log, and the DAU/role-mix
  // metric all see SSO logins too, not just password ones.
  await recordSuccessfulLogin(user.id);
  await writeAudit({
    actorId: user.id,
    actorRole: user.role,
    action: "auth.login",
    targetType: "User",
    targetId: user.id,
  });
  // Usage metric — Grafana derives DAU/WAU + role-mix from this.
  try {
    const { authSignins } = await import("@/lib/telemetry");
    authSignins.add(1, { role: user.role });
  } catch {
    /* metric SDK may not be initialized in tests */
  }

  const refreshed = (await findUserById(user.id)) ?? user;
  return { user: refreshed };
}
