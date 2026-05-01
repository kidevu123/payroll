// Remove a Web Push subscription. Idempotent.

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

const schema = z.object({ endpoint: z.string().url() });

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
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.endpoint, parsed.data.endpoint),
        eq(pushSubscriptions.userId, session.user.id),
      ),
    );
  return NextResponse.json({ ok: true });
}
