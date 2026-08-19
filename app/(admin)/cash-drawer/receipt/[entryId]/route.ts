// Streams a petty-cash receipt inline. Same gate as the drawer page.

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { cashDrawerEntries } from "@/lib/db/schema";
import {
  isReceiptPath,
  receiptMime,
} from "@/lib/cash-drawer/receipt-storage";

const DRAWER_ROLES = new Set(["OWNER", "ADMIN", "ACCOUNTANT"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ entryId: string }> },
) {
  const session = await auth();
  if (!session || !DRAWER_ROLES.has(session.user.role)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { entryId } = await params;
  if (!z.string().uuid().safeParse(entryId).success) {
    return new Response("Bad request", { status: 400 });
  }
  const [entry] = await db
    .select({ receiptPath: cashDrawerEntries.receiptPath })
    .from(cashDrawerEntries)
    .where(eq(cashDrawerEntries.id, entryId));
  if (!entry?.receiptPath || !isReceiptPath(entry.receiptPath)) {
    return new Response("Not found", { status: 404 });
  }
  let body: Buffer;
  try {
    body = await readFile(entry.receiptPath);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": receiptMime(entry.receiptPath),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
