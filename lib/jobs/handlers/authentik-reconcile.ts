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
