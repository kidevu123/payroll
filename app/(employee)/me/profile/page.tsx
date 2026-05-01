// Employee profile — view + edit, language toggle, sign out. Sensitive
// fields (legal name, email) are read-only here; admins update them
// from the Employee detail page.

import { getTranslations } from "next-intl/server";
import { LogOut, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireSession } from "@/lib/auth-guards";
import { getEmployee } from "@/lib/db/queries/employees";
import { signOutAction } from "@/components/admin/sign-out-action";
import { LanguageSwitcher } from "@/components/admin/language-switcher";
import { resolveLocale } from "@/lib/i18n";
import { ProfileForm } from "./profile-form";

export default async function EmployeeProfile() {
  const session = await requireSession();
  const t = await getTranslations("employee.profile");
  const locale = await resolveLocale();
  if (!session.user.employeeId) {
    return (
      <main className="px-4 py-6 space-y-4">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-text-muted">{t("noEmployeeRecord")}</p>
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
    <main className="px-4 py-6 space-y-4">
      <h1 className="text-xl font-semibold">{t("title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{employee.displayName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("email")}</Label>
              <Input value={employee.email} readOnly />
            </div>
            <div className="space-y-1">
              <Label>{t("legalName")}</Label>
              <Input value={employee.legalName} readOnly />
            </div>
          </div>
          <p className="text-xs text-text-muted">{t("changesNeedApproval")}</p>
        </CardContent>
      </Card>

      <ProfileForm employee={employee} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Languages className="h-4 w-4 text-brand-700" />
            English / Español
          </CardTitle>
          <LanguageSwitcher current={locale} />
        </CardHeader>
        <CardContent className="text-xs text-text-muted">
          Switches the language on this device immediately. Your saved
          preference (above) is what other devices use until they switch too.
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3 text-sm">
          <Button asChild variant="secondary" className="w-full justify-center">
            <a href="/me/profile/notifications">Notifications</a>
          </Button>
          <form action={signOutAction}>
            <Button type="submit" variant="secondary" className="w-full justify-center">
              <LogOut className="h-4 w-4" /> {t("signOut")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
