// Employee shell. Mobile-first with a max-width container and a fixed
// bottom-nav. The sw.js + manifest land via the root layout so they apply
// here automatically.
//
// Salaried staff don't punch in — their Time tab would show empty state
// forever — so we hide it via the BottomNav.hideTime flag based on the
// session user's payType.

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/auth-guards";
import { getEmployee } from "@/lib/db/queries/employees";
import { BottomNav } from "@/components/employee/bottom-nav";
import { ServiceWorkerRegister } from "@/components/employee/sw-register";
import { OnboardingBanner } from "@/components/employee/onboarding-banner";
import { AppTour } from "@/components/employee/app-tour";
import { AppFooter } from "@/components/app-footer";
import { getSetting } from "@/lib/settings/runtime";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  // Hard guard: only EMPLOYEE-role users belong in the employee shell.
  // Anyone else (Owner/Admin/Payroll-staff/Accountant) lands on /me/*
  // by mistake — usually because the root redirect sent them here in
  // an older build. Bounce them to root, which routes by role.
  if (session.user.role !== "EMPLOYEE") {
    redirect("/");
  }
  // Usage metric — every employee page render. Cheap fire-and-forget.
  try {
    const { sessionPing, pageRenders } = await import("@/lib/telemetry");
    sessionPing.add(1, { role: session.user.role, surface: "employee" });
    pageRenders.add(1, { surface: "employee" });
  } catch {
    /* metrics not critical to render */
  }
  const [employee, subs, t, company] = await Promise.all([
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
    getSetting("company").catch(() => null),
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
    <div className="dark min-h-dvh pb-[calc(5.5rem+env(safe-area-inset-bottom))] bg-page shell-employee">
      <ServiceWorkerRegister />
      {/* Phone-first shell: max-w-md feels right on a phone, but on
          tablet (sm+) the 448px cap looked cramped — esp. the calendar
          and pay-history. Bumping to max-w-2xl (672px) above sm gives
          tablets breathing room without touching the phone layout. */}
      <div className="max-w-md sm:max-w-2xl mx-auto page-enter">
        <OnboardingBanner alreadySubscribed={subs.length > 0} />
        {children}
      </div>
      <AppFooter
        className="pb-4 max-w-md sm:max-w-2xl mx-auto"
        timezone={company?.timezone ?? "America/New_York"}
      />
      <BottomNav hideTime={isSalaried} />
      <AppTour strings={tourStrings} />
    </div>
  );
}
