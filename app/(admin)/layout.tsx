import { requireAdmin } from "@/lib/auth-guards";
import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { AppFooter } from "@/components/app-footer";
import { unreadCount } from "@/lib/notifications/in-app";
import { getSetting } from "@/lib/settings/runtime";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPeriods } from "@/lib/db/queries/pay-periods";
import { resolveLocale } from "@/lib/i18n";
import type { CommandTarget } from "@/components/admin/command-palette";

const SETTINGS_TARGETS: CommandTarget[] = [
  { id: "set-company", label: "Settings · Company", href: "/settings/company", group: "settings" },
  { id: "set-pay-periods", label: "Settings · Pay periods", href: "/settings/pay-periods", group: "settings" },
  { id: "set-pay-rules", label: "Settings · Pay rules", href: "/settings/pay-rules", group: "settings" },
  { id: "set-shifts", label: "Settings · Shifts", href: "/settings/shifts", group: "settings" },
  { id: "set-holidays", label: "Settings · Holidays", href: "/settings/holidays", group: "settings" },
  { id: "set-ngteco", label: "Settings · NGTeco", href: "/settings/ngteco", group: "settings" },
  { id: "set-automation", label: "Settings · Automation", href: "/settings/automation", group: "settings" },
  { id: "set-notifications", label: "Settings · Notifications", href: "/settings/notifications", group: "settings" },
  { id: "set-security", label: "Settings · Security", href: "/settings/security", group: "settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const [unread, company, employees, periods, locale] = await Promise.all([
    unreadCount(session.user.id).catch(() => 0),
    getSetting("company").catch(() => null),
    listEmployees({ status: "ACTIVE" }).catch(() => []),
    listPeriods({ limit: 12 }).catch(() => []),
    resolveLocale(),
  ]);
  const companyForBrand = {
    name: company?.name ?? "Payroll",
    logoPath: company?.logoPath ?? null,
  };

  const employeeTargets: CommandTarget[] = employees.map((e) => ({
    id: `emp-${e.id}`,
    label: e.displayName,
    hint: e.email ?? undefined,
    href: `/employees/${e.id}`,
    group: "employee",
  }));
  const periodTargets: CommandTarget[] = periods.map((p) => ({
    id: `per-${p.id}`,
    label: `${p.startDate} → ${p.endDate}`,
    hint: p.state,
    href: `/payroll/${p.id}`,
    group: "period",
  }));

  return (
    <div className="min-h-dvh flex bg-page">
      <Sidebar company={companyForBrand} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          email={session.user.email}
          role={session.user.role}
          unreadCount={unread}
          commandTargets={[...employeeTargets, ...periodTargets, ...SETTINGS_TARGETS]}
          company={companyForBrand}
          currentLocale={locale}
        />
        <main className="flex-1 p-3 sm:p-4 lg:p-8 max-w-screen-2xl w-full mx-auto page-enter">
          {children}
        </main>
        <AppFooter />
      </div>
    </div>
  );
}
