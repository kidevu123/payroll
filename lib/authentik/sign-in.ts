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
import { getEmployee, setEmployeeDisplayName } from "@/lib/db/queries/employees";
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

  const refreshed = (await findUserById(user.id)) ?? user;
  return { user: refreshed };
}
