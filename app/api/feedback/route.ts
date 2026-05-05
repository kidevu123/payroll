// "Report a bug" intake. Wired to the floating button in the admin
// chrome (components/admin/feedback-launcher.tsx). Writes to
// app_feedback + emits a logger.error so it shows up in the Grafana
// errors panel — no separate alerting needed.

import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { appFeedback } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { writeAudit } from "@/lib/db/audit";
import { logger } from "@/lib/telemetry";

const schema = z.object({
  kind: z.enum(["BUG", "IDEA", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional().nullable(),
  message: z.string().min(1).max(4000),
  pageUrl: z.string().max(2000).optional().nullable(),
  userAgent: z.string().max(500).optional().nullable(),
  viewport: z.string().max(20).optional().nullable(),
});

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
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
  const [row] = await db
    .insert(appFeedback)
    .values({
      submittedById: session?.user?.id ?? null,
      kind: parsed.data.kind,
      severity: parsed.data.severity ?? null,
      message: parsed.data.message,
      pageUrl: parsed.data.pageUrl ?? null,
      userAgent: parsed.data.userAgent ?? null,
      viewport: parsed.data.viewport ?? null,
      buildSha: process.env.BUILD_GIT_SHA ?? null,
    })
    .returning();
  if (row) {
    if (session?.user?.id) {
      await writeAudit({
        actorId: session.user.id,
        actorRole: session.user.role,
        action: "feedback.submit",
        targetType: "AppFeedback",
        targetId: row.id,
      });
    }
    logger.info(
      {
        kind: row.kind,
        severity: row.severity,
        page: row.pageUrl,
        feedbackId: row.id,
      },
      "feedback received",
    );
  }
  return NextResponse.json({ ok: true, id: row?.id });
}
