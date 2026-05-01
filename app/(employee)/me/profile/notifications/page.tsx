// Per-user notification preferences: push-enable for this device + a
// listing of recent notifications. Channel-level defaults are managed
// by the admin in Settings → Notifications; this page is the user's
// device-scoped opt-in.

import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth-guards";
import { db } from "@/lib/db";
import { notifications, pushSubscriptions } from "@/lib/db/schema";
import { vapidConfigured } from "@/lib/notifications/push";
import { PushToggle } from "./push-toggle";

export default async function NotificationsPage() {
  const session = await requireSession();
  const configured = vapidConfigured();
  const [recent, subs] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.recipientId, session.user.id))
      .orderBy(desc(notifications.sentAt))
      .limit(20),
    db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, session.user.id)),
  ]);

  return (
    <main className="px-4 py-6 space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/me/profile">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Push notifications</CardTitle>
          <CardDescription>
            Get pinged on this device when payroll publishes or a missed-punch
            alert lands. Tied to this browser; revoking notification permission
            in your OS clears it on the next reconnect.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {configured ? (
            <PushToggle alreadySubscribed={subs.length > 0} />
          ) : (
            <div className="flex items-start gap-2 rounded-card border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  Push notifications aren&apos;t set up yet.
                </p>
                <p className="text-xs">
                  Your admin needs to configure VAPID keys before this
                  device can subscribe. They&apos;ll find the setup steps
                  under <strong>Settings → Notifications</strong>.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {recent.length === 0 ? (
            <p className="text-text-muted">Nothing yet.</p>
          ) : (
            recent.map((n) => (
              <div
                key={n.id}
                className="rounded-input border border-border px-3 py-2"
              >
                <div className="text-xs font-mono">{n.kind}</div>
                <div className="text-xs text-text-muted">
                  {n.sentAt?.toISOString().slice(0, 16).replace("T", " ")}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
