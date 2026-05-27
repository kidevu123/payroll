// Per-user notification preferences: push-enable for this device + a
// listing of recent notifications. Channel-level defaults are managed
// by the admin in Settings → Notifications; this page is the user's
// device-scoped opt-in.

import Link from "next/link";
import { ArrowLeft, AlertTriangle, BellRing, Trash2 } from "lucide-react";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
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
import { dismissNotificationAction } from "./actions";
import { PushToggle } from "./push-toggle";

export default async function NotificationsPage() {
  const session = await requireSession();
  const t = await getTranslations("employee.notifications");
  const configured = vapidConfigured();
  const [recent, subs] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, session.user.id),
          isNull(notifications.dismissedAt),
        ),
      )
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
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{t("pushTitle")}</CardTitle>
          <CardDescription>
            {t("pushDescription")}
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
                  {t("notConfiguredTitle")}
                </p>
                <p className="text-[11px] leading-relaxed">
                  {t("notConfiguredBody")}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("recentTitle")}</CardTitle>
          <CardDescription>{t("recentDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
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
                  <form action={dismissNotificationAction} className="shrink-0">
                    <input type="hidden" name="id" value={n.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-text-muted hover:text-danger-700"
                      title="Delete notification"
                      aria-label={`Delete notification ${n.kind}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
