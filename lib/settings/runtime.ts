// Typed Setting access. The only path through which the rest of the app reads
// or writes settings.
//
// Behavior:
//   • get<K>() returns the parsed, defaulted value. Missing rows resolve to
//     the schema's defaults — never null. This makes settings "always present."
//   • set<K>() validates with Zod, writes the row, and writes an AuditLog entry.
//   • A per-request memo cache avoids round-trips inside one request lifecycle.
//
// Cache invalidation: the `cache: "no-store"` semantics of server actions, plus
// the per-request memo, keep this simple. We never add a process-wide cache —
// that's a foot-gun across multiple replicas.

import { eq } from "drizzle-orm";
import { z } from "zod";
import { cache } from "react";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";
import {
  settingsRegistry,
  type SettingKey,
  type SettingValue,
  type CompanySettings,
} from "./schemas";

/**
 * Read a setting, applying schema defaults when the row is missing.
 * `cache()` memos within a single request render.
 */
export const getSetting = cache(async <K extends SettingKey>(
  key: K,
): Promise<SettingValue<K>> => {
  const schema = settingsRegistry[key];
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  // Parse with Zod even on miss → defaults flow through.
  return schema.parse(row?.value ?? {}) as SettingValue<K>;
});

/**
 * Write a setting. Validates with Zod, upserts, audits.
 */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  ctx: { actorId: string; actorRole: "OWNER" | "ADMIN" | "EMPLOYEE" },
): Promise<void> {
  const schema = settingsRegistry[key];
  const parsed = schema.parse(value);
  const before = await getSetting(key);
  await db
    .insert(settings)
    .values({ key, value: parsed, updatedById: ctx.actorId })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: parsed, updatedAt: new Date(), updatedById: ctx.actorId },
    });
  await writeAudit({
    actorId: ctx.actorId,
    actorRole: ctx.actorRole,
    action: "settings.update",
    targetType: "Setting",
    targetId: key,
    before,
    after: parsed,
  });
}

// ─── Convenience getters ─────────────────────────────────────────────────────
// These are the read paths called from layout.tsx, server actions, etc.

export async function getCompanySettings(): Promise<CompanySettings | null> {
  try {
    return await getSetting("company");
  } catch {
    // First-run, before migrations have populated defaults — render defaults.
    return null;
  }
}

/**
 * Resolve channels for a given event kind, applying registry defaults.
 */
export async function getNotificationChannels(kind: string) {
  const config = await getSetting("notifications");
  const def = (config.defaults as Record<string, unknown>)[kind];
  return z
    .object({
      in_app: z.boolean(),
      email: z.boolean(),
      push: z.boolean(),
    })
    .parse(def ?? { in_app: true, email: false, push: true });
}
