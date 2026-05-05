import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth-guards";
import { Sidebar } from "@/components/admin/sidebar";
import { Topbar } from "@/components/admin/topbar";
import { FeedbackLauncher } from "@/components/admin/feedback-launcher";
import { AppFooter } from "@/components/app-footer";
import { getSetting } from "@/lib/settings/runtime";
import { assetVersion } from "@/lib/branding/storage";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPeriods } from "@/lib/db/queries/pay-periods";
import {
  listPendingMissedPunchRequests,
  listPendingTimeOffRequests,
} from "@/lib/db/queries/requests";
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
  { id: "set-google-calendar", label: "Settings · Google Calendar", href: "/settings/google-calendar", group: "settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Cash drawer is the one (admin) route accountants can reach; their
  // role is otherwise scoped strictly to that page. Everyone else
  // hitting any other (admin) path is bounced to /cash-drawer so they
  // never see employees, payroll runs, settings, etc.
  const session = await requireRole(
    "OWNER",
    "ADMIN",
    "PAYROLL_STAFF",
    "ACCOUNTANT",
  );
  if (session.user.role === "ACCOUNTANT") {
    const h = await headers();
    const pathname = h.get("x-pathname") ?? h.get("x-invoke-path") ?? "";
    if (pathname && !pathname.startsWith("/cash-drawer")) {
      redirect("/cash-drawer");
    }
  }
  // Usage metrics — one ping per admin page render. Grafana aggregates
  // these into DAU/WAU + active-admin counts. Cheap fire-and-forget.
  try {
    const { sessionPing, pageRenders } = await import("@/lib/telemetry");
    sessionPing.add(1, { role: session.user.role, surface: "admin" });
    pageRenders.add(1, { surface: "admin" });
  } catch {
    /* metrics not critical to render */
  }
  // Bell badge reflects what the admin will SEE on /requests — pending
  // missed-punch + pending time-off requests. Was previously
  // unreadCount(notifications), which drifted from the page contents and
  // produced badges with no rows behind them ("8" with empty inbox).
  const [missedReqs, timeOffReqs, company, employees, periods, locale, logoVersion] = await Promise.all([
    listPendingMissedPunchRequests().catch(() => []),
    listPendingTimeOffRequests().catch(() => []),
    getSetting("company").catch(() => null),
    listEmployees({ status: "ACTIVE" }).catch(() => []),
    listPeriods({ limit: 12 }).catch(() => []),
    resolveLocale(),
    assetVersion("logo").catch(() => "default"),
  ]);
  const unread = missedReqs.length + timeOffReqs.length;
  // Override the stored logoPath's cache-bust with a fresh mtime stamp so
  // any server-side post-processing of the asset (e.g. transparent-margin
  // trimming) shows up in browsers that cached an earlier URL. The stored
  // path is keyed off the upload time only, which goes stale when we
  // reprocess existing files.
  const logoHref = company?.logoPath
    ? `/api/branding/logo?v=${logoVersion}`
    : null;
  const companyForBrand = {
    name: company?.name ?? "Payroll",
    logoPath: logoHref,
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
      <Sidebar company={companyForBrand} role={session.user.role as "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT"} />
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
      <FeedbackLauncher />
    </div>
  );
}
