import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth-guards";
import {
  effectiveSurfacesFor,
  isAccountantPeriodReviewPath,
  type Surface,
} from "@/lib/auth/role-matrix";
import { DashboardDarkShell } from "@/components/dashboard/dark-shell";
import { getTranslations } from "next-intl/server";
import { MobileQuickNav } from "@/components/admin/mobile-nav";
import { FeedbackLauncher } from "@/components/admin/feedback-launcher";
import { PollStatusBar, PollStatusProvider } from "@/components/admin/poll-status-provider";
import { getSetting } from "@/lib/settings/runtime";
import { assetVersion } from "@/lib/branding/storage";
import { listEmployees } from "@/lib/db/queries/employees";
import { listPeriods } from "@/lib/db/queries/pay-periods";
import {
  listPendingMissedPunchRequests,
  listPendingTimeOffRequests,
} from "@/lib/db/queries/requests";
import { countRecentAnnouncements } from "@/lib/db/queries/announcements";
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
  // Resolve the user's allowed admin surfaces from the editable role
  // matrix (defaults baked in if unset). We use this to (a) drive the
  // sidebar nav and (b) bounce the user off any surface they don't have
  // access to. Owners always pass.
  const allowedSurfaces = await effectiveSurfacesFor(session.user.role);
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? hdrs.get("x-invoke-path") ?? "";
  // Theme is a per-user preference persisted in the `milo-theme` cookie.
  // Default is dark (the showcase canvas); light renders the #58 aesthetic.
  // The class is applied to the admin root so the toggle is scoped to the
  // app chrome and never darkens the auth/login pages.
  const themeCookie = (await cookies()).get("milo-theme")?.value;
  const themeClass = themeCookie === "light" ? "" : "dark";
  if (session.user.role !== "OWNER") {
    if (pathname) {
      // Match the path's first segment against the surface keys ("/cash-drawer", etc.)
      const allowedRoots = new Set(allowedSurfaces);
      const matchesAllowed = [...allowedRoots].some(
        (s) => pathname === s || pathname.startsWith(s + "/"),
      );
      const isAccountantPeriodReview =
        session.user.role === "ACCOUNTANT" &&
        isAccountantPeriodReviewPath(pathname);
      if (!matchesAllowed && !isAccountantPeriodReview && pathname !== "/") {
        // Fall through to the first allowed surface, or "/" if the user
        // has no admin surfaces (employee role landing here by mistake).
        const fallback = allowedSurfaces[0] ?? "/";
        redirect(fallback);
      }
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
  // Pending-work badges are attributed to the section that owns the work:
  // missed-punch reviews live on Time, time-off requests on Calendar, and
  // Notifications shows a recent-activity count (announcements from the
  // last 7 days). Keyed by nav href so the shells can drop the count on
  // the matching item.
  const [missedReqs, timeOffReqs, company, employees, periods, locale, logoVersion, recentAnnouncements] = await Promise.all([
    listPendingMissedPunchRequests().catch(() => []),
    listPendingTimeOffRequests().catch(() => []),
    getSetting("company").catch(() => null),
    listEmployees({ status: "ACTIVE" }).catch(() => []),
    listPeriods({ limit: 12 }).catch(() => []),
    resolveLocale(),
    assetVersion("logo").catch(() => "default"),
    countRecentAnnouncements(7).catch(() => 0),
  ]);
  const missedCount = missedReqs.length;
  const timeOffCount = timeOffReqs.length;
  const navBadges: Record<string, number> = {
    "/time": missedCount,
    "/calendar": timeOffCount,
    // Owner direction (Jul 2026 mock): Notifications carries a count too —
    // announcements sent in the last 7 days, i.e. "recent activity", since
    // the feed has no per-user read tracking to badge against.
    "/notifications": recentAnnouncements,
  };
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

  const commandTargets = [...employeeTargets, ...periodTargets, ...SETTINGS_TARGETS];

  // Every admin route renders the cohesive dark shell. (A light Sidebar +
  // Topbar shell used to live below this as an `if (isDashboardRoute)`
  // fallback with the flag hardcoded to true — 55 lines of unreachable code
  // that kept sprouting stale 3.5rem topbar offsets in live pages.)
  const meEmp = session.user.employeeId
    ? employees.find((e) => e.id === session.user.employeeId) ?? null
    : null;
  const friendlyFromEmail = (email: string): string => {
    const local = email.split("@")[0] ?? email;
    const first = local.split(/[._-]+/).filter(Boolean)[0] ?? local;
    return first.charAt(0).toUpperCase() + first.slice(1);
  };
  const displayName = meEmp?.displayName ?? friendlyFromEmail(session.user.email);
  const roleLabel =
    session.user.role.charAt(0) + session.user.role.slice(1).toLowerCase().replace(/_/g, " ");
  const avatarUrl = meEmp
    ? `/api/employees/${meEmp.id}/photo?v=${meEmp.id.slice(0, 8)}`
    : null;
  const tAuth = await getTranslations("auth");
  // Build/version footer — preserves the SHA + server-time marker the light
  // shell shows, computed server-side so the time is the server's clock.
  const shaFull = process.env.NEXT_PUBLIC_GIT_SHA ?? "";
  const sha = shaFull ? shaFull.slice(0, 7) : "dev";
  const tz = company?.timezone ?? "America/New_York";
  const serverTime = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date());
  return (
    <PollStatusProvider>
      <div id="admin-root" className={themeClass}>
        <DashboardDarkShell
          company={companyForBrand}
          user={{
            name: displayName,
            role: roleLabel,
            email: session.user.email,
            avatarUrl,
          }}
          allowedSurfaces={allowedSurfaces as ReadonlyArray<Surface>}
          badges={navBadges}
          commandTargets={commandTargets}
          signOutLabel={tAuth("signOut")}
          footer={{ sha, shaFull, serverTime }}
        >
          {/* NGTeco poll progress — shown on every admin page. */}
          <PollStatusBar />
          {children}
        </DashboardDarkShell>
        {/* Mobile navigation — hands off to the dark shell's icon rail at md. */}
        <MobileQuickNav
          company={companyForBrand}
          currentLocale={locale}
          allowedSurfaces={allowedSurfaces as ReadonlyArray<Surface>}
          badges={navBadges}
          hideFrom="md"
        />
        <FeedbackLauncher />
      </div>
    </PollStatusProvider>
  );
}
