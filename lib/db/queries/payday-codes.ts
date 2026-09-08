// Payday-signing codes (see kioskPaydayCodes in the schema). Issue from
// the admin period page, redeem once from the warehouse tablet.

import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { kioskPaydayCodes } from "@/lib/db/schema";
import { PAYDAY_CODE_TTL_S, generatePaydayCode } from "@/lib/kiosk/payday";

/**
 * Mint a fresh single-use code for a period. Earlier unconsumed codes for
 * the same period are revoked so only the newest one on the owner's
 * screen works; stale rows from any period are pruned while we're here.
 */
export async function issuePaydayCode(
  periodId: string,
  issuedById: string | null,
  now: Date = new Date(),
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + PAYDAY_CODE_TTL_S * 1000);
  return db.transaction(async (tx) => {
    await tx
      .delete(kioskPaydayCodes)
      .where(
        or(
          eq(kioskPaydayCodes.periodId, periodId),
          lt(kioskPaydayCodes.expiresAt, now),
        ),
      );
    // The unique index on code guards the (astronomically unlikely)
    // collision with a live code; retry a few times rather than fail.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generatePaydayCode();
      const [row] = await tx
        .insert(kioskPaydayCodes)
        .values({ code, periodId, issuedById, expiresAt })
        .onConflictDoNothing({ target: kioskPaydayCodes.code })
        .returning({ code: kioskPaydayCodes.code });
      if (row) return { code: row.code, expiresAt };
    }
    throw new Error("issuePaydayCode: could not allocate a unique code");
  });
}

/** Redeem a code. Returns the period id exactly once; null otherwise. */
export async function consumePaydayCode(
  code: string,
  now: Date = new Date(),
): Promise<string | null> {
  const [row] = await db
    .update(kioskPaydayCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(kioskPaydayCodes.code, code),
        isNull(kioskPaydayCodes.consumedAt),
        gt(kioskPaydayCodes.expiresAt, now),
      ),
    )
    .returning({ periodId: kioskPaydayCodes.periodId });
  return row?.periodId ?? null;
}
