// Health check. Used by docker compose healthcheck and the LX120 deploy script.

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getBoss } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const checks: Record<string, "ok" | "error"> = { app: "ok" };
  const start = Date.now();

  try {
    await db.execute(sql`select 1`);
    checks.db = "ok";
  } catch {
    checks.db = "error";
  }

  try {
    const boss = await getBoss();
    checks.boss = boss ? "ok" : "error";
  } catch {
    checks.boss = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks, elapsedMs: Date.now() - start },
    { status: allOk ? 200 : 503 },
  );
}
