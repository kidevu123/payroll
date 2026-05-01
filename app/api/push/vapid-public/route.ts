// Returns the VAPID public key (base64url) so the browser can build a
// PushSubscription. Auth-gated to a logged-in session.

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";

export async function GET(): Promise<Response> {
  await requireSession();
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return new NextResponse("VAPID not configured", { status: 503 });
  }
  return NextResponse.json({ publicKey: key });
}
