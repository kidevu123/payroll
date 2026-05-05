// Per-user notification preferences: push-enable for this device + a
// listing of recent notifications. Channel-level defaults are managed
// by the admin in Settings → Notifications; this page is the user's
// device-scoped opt-in.

import Link from "next/link";
import { ArrowLeft, AlertTriangle, BellRing } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
    <main className="px-4 py-6 sm:px-6 sm:py-8 space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/me/profile">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Push notifications</CardTitle>
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
            <div className="flex items-start gap-2.5 rounded-card border border-warn-200/80 bg-warn-50 p-3.5 text-sm text-warn-700">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden
              />
              <div className="space-y-1">
                <p className="font-medium tracking-tight">
                  Push notifications aren&apos;t set up yet.
                </p>
                <p className="text-[11px] leading-relaxed">
                  Your admin needs to configure VAPID keys before this device
                  can subscribe. They&apos;ll find the setup steps under{" "}
                  <strong>Settings → Notifications</strong>.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent notifications</CardTitle>
          <CardDescription>Last 20 alerts sent to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title="No notifications yet"
              description="Anything we send to you will show up here."
              tone="neutral"
            />
          ) : (
            <ul className="space-y-1.5">
              {recent.map((n) => (
                <li
                  key={n.id}
                  className="flex items-center justify-between gap-3 rounded-input border border-border/70 bg-surface px-3 py-2.5"
                >
                  <span className="font-mono text-[11px] tracking-tight text-text truncate">
                    {n.kind}
                  </span>
                  <span className="text-[10px] text-text-muted tabular-nums shrink-0">
                    {n.sentAt?.toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
