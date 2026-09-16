// Resolve an Authentik OIDC identity to a payroll user, then let Authentik's
// profile win.
//
// A payroll user must be PROVISIONED before they can sign in via SSO.
// Provisioning (lib/authentik/provision.ts) is what binds `authentik_sub` —
// at link/create time, when payroll knows precisely which Authentik account
// it matched or created. Sign-in never binds: it resolves by subject alone,
// via findUserByAuthentikSub, and refuses anyone it can't find that way. This
// is deliberate — email is not a resolution path at all, so there is no
// login-time window where a person who has set their Authentik email to a
// payroll user's address could claim that account (role, employee linkage,
// pay) out from under its real owner. The unprovisioned-user consequence is
// intended, not an oversight: provisioning runs on user creation and
// nightly, and /settings/sso lists anyone still missing.
//
// Payroll stays the source of truth for role, employee linkage, pay, and
// enabled/disabled. This function never creates a payroll user: an Authentik
// identity with no payroll account is refused.

import type { User } from "@/lib/db/schema";
import { db } from "@/lib/db";
import {
  findUserByAuthentikSub,
  findUserByEmail,
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
  | { rejected: "no-payroll-user" | "disabled" | "no-identity" };

/**
 * Resolve an Authentik identity to a payroll user. Read-only: no links, no
 * merges, no audit rows. The jwt callback uses this, because it runs on
 * every token refresh and must not repeat the sign-in side effects.
 */
export async function resolveAuthentikIdentity(input: {
  sub: string | null;
  email: string | null;
}): Promise<SignInResolution> {
  const sub = input.sub?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  if (sub.length === 0 && email.length === 0) return { rejected: "no-identity" };

  const user = sub.length > 0 ? await findUserByAuthentikSub(sub) : null;
  if (!user) return { rejected: "no-payroll-user" };
  if (user.disabledAt) return { rejected: "disabled" };

  return { user };
}

export async function resolveAuthentikSignIn(input: {
  sub: string | null;
  email: string | null;
  name: string | null;
}): Promise<SignInResolution> {
  const identity = await resolveAuthentikIdentity({ sub: input.sub, email: input.email });

  if (!("user" in identity)) {
    return identity;
  }

  const user = identity.user;
  const email = input.email?.trim() ?? "";

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
    // Mutation and its audit row are one transaction: a crash between them
    // would leave an unaudited change to a login identifier, and the repo's
    // rule is that every mutation is audited before commit (Task 6 fixed
    // this same pattern in the provisioner).
    const emailChange = merge.email;
    await db.transaction(async (tx) => {
      await applyAuthentikProfile(user.id, { email: emailChange.to }, tx);
      await writeAudit(
        {
          actorId: user.id,
          actorRole: user.role,
          action: "authentik.merge.applied",
          targetType: "User",
          targetId: user.id,
          before: { email: emailChange.from },
          after: { email: emailChange.to },
        },
        tx,
      );
    });
  }

  if (merge.displayName && user.employeeId) {
    // Same reasoning as the email branch above: this name prints on
    // payslips, so its mutation and audit row must commit together.
    const displayNameChange = merge.displayName;
    const employeeId = user.employeeId;
    await db.transaction(async (tx) => {
      await setEmployeeDisplayName(employeeId, displayNameChange.to, tx);
      await writeAudit(
        {
          actorId: user.id,
          actorRole: user.role,
          action: "authentik.merge.applied",
          targetType: "Employee",
          targetId: employeeId,
          after: { displayName: displayNameChange.to },
        },
        tx,
      );
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
