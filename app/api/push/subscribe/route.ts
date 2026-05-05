// Persist a Web Push subscription for the signed-in user.

import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";
import { writeAudit } from "@/lib/db/audit";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  userAgent: z.string().optional().nullable(),
});

export async function POST(req: Request): Promise<Response> {
  const session = await requireSession();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  // Upsert by endpoint (unique). If the same endpoint already belongs to
  // a different user, replace the user_id.
  const [existing] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, parsed.data.endpoint));
  if (existing) {
    await db
      .update(pushSubscriptions)
      .set({
        userId: session.user.id,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent ?? existing.userAgent,
      })
      .where(eq(pushSubscriptions.id, existing.id));
    await writeAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "push.subscription.update",
      targetType: "PushSubscription",
      targetId: existing.id,
    });
  } else {
    const [row] = await db
      .insert(pushSubscriptions)
      .values({
        userId: session.user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent ?? null,
      })
      .returning();
    if (row) {
      await writeAudit({
        actorId: session.user.id,
        actorRole: session.user.role,
        action: "push.subscription.create",
        targetType: "PushSubscription",
        targetId: row.id,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
