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
      /** Absent on a dry run: a preview has no real account to point at. */
      authentikPk?: number;
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
  // Everything, including the lookup, sits inside the try: a transient DB
  // error here must become a "failed" outcome, not an exception. An exception
  // would escape provisionMissingUsers' loop and abort the sweep for every
  // remaining user.
  let user: typeof users.$inferSelect | undefined;
  try {
    [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) return { status: "failed", userId, email: "", error: "User not found." };

    const client = opts?.client ?? getAuthentikClient();
    if (!client) {
      return { status: "skipped", userId, email: user.email, reason: "not-configured" };
    }

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
      // No pk is invented for a would-be creation: authentikPk is optional on
      // the outcome precisely so a preview cannot be mistaken for a real link.
      return {
        status: decision.action === "link" ? "linked" : "created",
        userId,
        email: user.email,
        username: decision.username,
        ...(decision.action === "link" ? { authentikPk: decision.authentikPk } : {}),
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

    // The link and its audit row are one transaction: a crash between them
    // would leave an unaudited Authentik link, and the repo's rule is that
    // every mutation is audited before commit.
    // (email captured here, not read as `user.email` inside the closure: TS
    // cannot carry the earlier `if (!user) return` narrowing of a `let`
    // variable across a nested function boundary.)
    const email = user.email;
    await db.transaction(async (tx) => {
      await linkAuthentikAccount(userId, { pk: authentikPk, username: decision.username }, tx);
      await writeAudit(
        {
          actorId: null,
          actorRole: null,
          action:
            decision.action === "link" ? "authentik.user.linked" : "authentik.user.provisioned",
          targetType: "User",
          targetId: userId,
          after: { authentikPk, username: decision.username, email },
        },
        tx,
      );
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
    const email = user?.email ?? "";
    logger.warn({ err, userId }, "authentik: provisioning failed");
    await writeAudit({
      actorId: null,
      actorRole: null,
      action: "authentik.sync.failed",
      targetType: "User",
      targetId: userId,
      after: { error: message },
    }).catch(() => undefined);
    return { status: "failed", userId, email, error: message };
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
    // Belt and braces: provisionPayrollUser is written not to throw, but one
    // user must never be able to abort the sweep for the rest.
    try {
      outcomes.push(
        await provisionPayrollUser(user.id, {
          ...(opts?.dryRun ? { dryRun: true } : {}),
        }),
      );
    } catch (err) {
      outcomes.push({
        status: "failed",
        userId: user.id,
        email: user.email,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
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
