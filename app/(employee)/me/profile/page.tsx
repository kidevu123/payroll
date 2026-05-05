// Employee profile — premium polish.
//
// Layout:
//   1. Identity header — avatar (initials in a brand-tinted circle),
//      name, email, role chip
//   2. Account details (read-only, server-controlled fields)
//   3. Editable preferences (display name, phone, language)
//   4. Language switcher (per-device override)
//   5. Notifications + Sign out (action surface)
//
// Sensitive fields (legal name, email) remain read-only; admins update
// them from the Employee detail page. Hrefs and server actions unchanged.

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LogOut, Languages, Bell, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/domain/avatar";
import { requireSession } from "@/lib/auth-guards";
import { getEmployee } from "@/lib/db/queries/employees";
import { signOutAction } from "@/components/admin/sign-out-action";
import { LanguageSwitcher } from "@/components/admin/language-switcher";
import { resolveLocale } from "@/lib/i18n";
import { ProfileForm } from "./profile-form";

function payTypeLabel(payType: "HOURLY" | "FLAT_TASK" | "SALARIED"): string {
  if (payType === "HOURLY") return "Hourly";
  if (payType === "SALARIED") return "Salaried";
  return "Flat-task";
}

export default async function EmployeeProfile() {
  const session = await requireSession();
  const t = await getTranslations("employee.profile");
  const locale = await resolveLocale();
  if (!session.user.employeeId) {
    return (
      <main className="px-4 py-6 space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight antialiased">
          {t("title")}
        </h1>
        <p className="text-sm text-text-muted leading-relaxed">
          {t("noEmployeeRecord")}
        </p>
        <form action={signOutAction}>
          <Button type="submit" variant="secondary">
            <LogOut className="h-4 w-4" /> {t("signOut")}
          </Button>
        </form>
      </main>
    );
  }

  const employee = await getEmployee(session.user.employeeId);
  if (!employee) return <main className="p-4">—</main>;

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 space-y-5">
      {/* Identity header — avatar + name + email + role chip. The avatar
          uses brand-tinted initials so the surface immediately reads as
          "this is YOU" without needing a photo upload feature. */}
      <Card>
        <CardContent className="px-6 py-5 flex items-center gap-4">
          <Avatar name={employee.displayName} size="lg" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <h1 className="text-base font-semibold tracking-tight antialiased truncate">
              {employee.displayName}
            </h1>
            <p className="text-xs text-text-muted truncate">
              {employee.email}
            </p>
            <div className="pt-1.5">
              <span className="inline-flex items-center gap-1 rounded-chip border border-brand-100 bg-brand-50 px-2 py-0.5 text-[10px] font-medium tracking-tight text-brand-800">
                {payTypeLabel(employee.payType)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account details — read-only fields. Compact; admin owns them. */}
      <Card>
        <CardHeader>
          <CardTitle>Account details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1">
              <Label>{t("email")}</Label>
              <Input value={employee.email} readOnly />
            </div>
            <div className="space-y-1">
              <Label>{t("legalName")}</Label>
              <Input value={employee.legalName} readOnly />
            </div>
          </div>
          <p className="text-[11px] text-text-muted leading-relaxed">
            {t("changesNeedApproval")}
          </p>
        </CardContent>
      </Card>

      <ProfileForm employee={employee} />

      {/* Per-device language switcher. The "saved" preference (set above)
          is what new devices use; this overrides only the current one. */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Languages className="h-4 w-4 text-brand-700" />
            {t("language")}
          </CardTitle>
          <LanguageSwitcher current={locale} />
        </CardHeader>
        <CardContent className="text-[11px] text-text-muted leading-relaxed">
          Switches the language on this device immediately. Your saved
          preference (above) is what other devices use until they switch
          too.
        </CardContent>
      </Card>

      {/* Action rail — notifications + sign out. Notifications is the
          primary action (chevron + brand tint); sign out is muted. */}
      <Card>
        <CardContent className="px-3 py-3 space-y-1.5">
          <Link
            href="/me/profile/notifications"
            className="group flex items-center gap-3 rounded-input px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 ring-1 ring-inset ring-brand-100">
              <Bell className="h-4 w-4 text-brand-700" aria-hidden />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium tracking-tight text-text antialiased">
                Notifications
              </p>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Push alerts when payroll publishes
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-text-subtle transition-transform group-hover:translate-x-0.5" />
          </Link>

          <form action={signOutAction}>
            <button
              type="submit"
              className="group flex w-full items-center gap-3 rounded-input px-3 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 ring-1 ring-inset ring-border">
                <LogOut className="h-4 w-4 text-text-muted" aria-hidden />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium tracking-tight text-text antialiased">
                  {t("signOut")}
                </p>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Ends this browser session
                </p>
              </div>
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
