// Employee shell. Mobile-first with a max-width container and a fixed
// bottom-nav. The sw.js + manifest land via the root layout so they apply
// here automatically.
//
// Salaried staff don't punch in — their Time tab would show empty state
// forever — so we hide it via the BottomNav.hideTime flag based on the
// session user's payType.

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth-guards";
import { getEmployee } from "@/lib/db/queries/employees";
import { BottomNav } from "@/components/employee/bottom-nav";
import { ServiceWorkerRegister } from "@/components/employee/sw-register";
import { OnboardingBanner } from "@/components/employee/onboarding-banner";
import { AppTour } from "@/components/employee/app-tour";
import { AppFooter } from "@/components/app-footer";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const [employee, subs, t] = await Promise.all([
    session.user.employeeId
      ? getEmployee(session.user.employeeId)
      : Promise.resolve(null),
    // Banner only hides the notify CTA when at least one active push
    // subscription exists for this user. New device → re-prompt.
    db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, session.user.id))
      .limit(1),
    getTranslations("employee.tour"),
  ]);
  const isSalaried = employee?.payType === "SALARIED";
  const tourStrings = {
    welcomeTitle: t("welcomeTitle"),
    welcomeBody: t("welcomeBody"),
    start: t("start"),
    skip: t("skip"),
    next: t("next"),
    done: t("done"),
    steps: {
      home: { title: t("steps.home.title"), body: t("steps.home.body") },
      time: { title: t("steps.time.title"), body: t("steps.time.body") },
      pay: { title: t("steps.pay.title"), body: t("steps.pay.body") },
      profile: {
        title: t("steps.profile.title"),
        body: t("steps.profile.body"),
      },
      notifications: {
        title: t("steps.notifications.title"),
        body: t("steps.notifications.body"),
      },
    },
  };
  return (
    <div className="min-h-dvh pb-20 bg-page">
      <ServiceWorkerRegister />
      <div className="max-w-md mx-auto page-enter">
        <OnboardingBanner alreadySubscribed={subs.length > 0} />
        {children}
      </div>
      <AppFooter className="pb-2 max-w-md mx-auto" />
      <BottomNav hideTime={isSalaried} />
      <AppTour strings={tourStrings} />
    </div>
  );
}
