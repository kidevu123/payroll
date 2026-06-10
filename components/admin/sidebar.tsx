// Admin sidebar — sectioned nav with active accent. Lucide icons only (§9).
//
// Visual language tuned to match premium SaaS sidebars (Linear, Vercel,
// Stripe Dashboard, Notion):
//   • Subtly tinted page background bleeds into the sidebar (no hard
//     border on the right — just a soft divider).
//   • Wordmark sits at the top WITHOUT a tile/sticker — the glyph is
//     rendered raw next to "Milo" so it reads as part of the chrome.
//   • Section headings: text-[10px] uppercase tracking-[0.08em] semi-
//     muted, with airy spacing.
//   • Items: rounded-lg, gap-3, text-[13px], py-2, soft hover bg.
//   • Active: subtle brand tint + brand-700 left edge bar + brand icon.
//     Pill background is desaturated so the colored chrome doesn't
//     compete with the page content.
//   • Footer pinned: Settings link + system pulse on a hairline divider.

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Wallet,
  BarChart3,
  ClipboardCheck,
  Bot,
  Settings2,
  Briefcase,
  CalendarRange,
  Banknote,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";

type NavItem = { href: string; labelKey: string; icon: LucideIcon };

const SECTIONS: { headingKey: string; items: NavItem[] }[] = [
  {
    headingKey: "overview",
    items: [{ href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard }],
  },
  {
    headingKey: "manage",
    items: [
      { href: "/time", labelKey: "time", icon: CalendarDays },
      { href: "/payroll", labelKey: "payroll", icon: Wallet },
      { href: "/salaried", labelKey: "salaried", icon: Briefcase },
      // Calendar + Requests merged: pending requests now live in a
      // rail on /calendar so admins see "who's out when" and "what's
      // waiting on me" in one glance instead of bouncing between
      // pages. /requests still resolves (server redirect) for any
      // bookmarks or notification deeplinks.
      { href: "/calendar", labelKey: "calendar", icon: CalendarRange },
    ],
  },
  {
    headingKey: "operate",
    items: [
      { href: "/hall-monitor", labelKey: "hallMonitor", icon: ClipboardCheck },
      { href: "/assistant", labelKey: "assistant", icon: Bot },
      { href: "/reports", labelKey: "reports", icon: BarChart3 },
      { href: "/cash-drawer", labelKey: "cashDrawer", icon: Banknote },
      { href: "/notifications", labelKey: "notifications", icon: Megaphone },
    ],
  },
];

const FOOTER_NAV: NavItem = {
  href: "/settings",
  labelKey: "settings",
  icon: Settings2,
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({
  company,
  systemHealthy = true,
  role = "ADMIN",
  allowedSurfaces,
}: {
  company: { name: string; logoPath: string | null };
  systemHealthy?: boolean;
  role?: "OWNER" | "ADMIN" | "PAYROLL_STAFF" | "ACCOUNTANT";
  /** Surface keys this role can reach — derived from the editable
   *  role matrix in /settings/roles. If omitted the full nav is shown
   *  (owner-equivalent fallback for safety). */
  allowedSurfaces?: ReadonlyArray<string>;
}) {
  const pathname = usePathname() ?? "";
  const tNav = useTranslations("nav");
  // Filter the canonical nav by what this role can reach. We keep
  // section structure but drop empty sections to avoid orphan headings.
  const allowSet = allowedSurfaces ? new Set(allowedSurfaces) : null;
  const sections = SECTIONS.map((sec) => ({
    ...sec,
    items: allowSet
      ? sec.items.filter((it) => allowSet.has(it.href))
      : sec.items,
  })).filter((sec) => sec.items.length > 0);
  const settingsAllowed = allowSet ? allowSet.has("/settings") : true;

  return (
    <aside
      className={cn(
        // Fixed to the viewport so Settings + system status never scroll away
        // when the main column is taller than the screen.
        "hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col h-dvh",
        "bg-surface backdrop-blur-sm",
        // Layered right-edge treatment: subtle shadow + hairline border
        "border-r border-border/50",
        "shadow-[2px_0_8px_-2px_rgb(15_23_42_/_0.06),1px_0_0_0_rgb(15_23_42_/_0.03)]",
      )}
    >
      <div className="px-5 pt-5 pb-4 shrink-0">
        <Wordmark
          name="Milo"
          logoPath={company.logoPath}
          size="md"
          showName={false}
        />
      </div>

      <nav className="flex-1 px-3 space-y-6 overflow-y-auto pb-4">
        {sections.map((sec) => (
          <div key={sec.headingKey}>
            {/* Section heading: uppercase label flanked by hairline rules */}
            <div className="flex items-center gap-2 px-2 mb-2">
              <span className="flex-1 h-px bg-border/60" />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.11em] text-text-subtle/70 shrink-0">
                {tNav(sec.headingKey)}
              </span>
              <span className="flex-1 h-px bg-border/60" />
            </div>
            <ul className="space-y-0.5">
              {sec.items.map(({ href, labelKey, icon: Icon }) => (
                <SidebarItem
                  key={href}
                  href={href}
                  label={tNav(labelKey)}
                  Icon={Icon}
                  active={isActive(pathname, href)}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="relative mt-auto px-3 pb-4 pt-3 shrink-0 space-y-1">
        {/* Top hairline separator with brand-tinted center peak */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent pointer-events-none"
        />
        {settingsAllowed && (
          <SidebarItem
            href={FOOTER_NAV.href}
            label={tNav(FOOTER_NAV.labelKey)}
            Icon={FOOTER_NAV.icon}
            active={isActive(pathname, FOOTER_NAV.href)}
          />
        )}
        <SystemStatus healthy={systemHealthy} />
      </div>
    </aside>
  );
}

function SidebarItem({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
}) {
  return (
    <li className="list-none">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-semibold tracking-tight transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
          active
            ? // Active: richer brand fill with layered inner highlight + stronger left bar
              [
                "bg-gradient-to-r from-brand-50 to-brand-50/60 text-brand-900",
                "shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.7),inset_0_0_0_1px_rgb(15_118_110_/_0.12),0_1px_2px_0_rgb(15_118_110_/_0.06)]",
              ]
            : "text-text-muted hover:bg-surface-2/80 hover:text-text hover:shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.5)]",
        )}
      >
        {/* Active left bar — 3px, taller than before, sharp brand-700 */}
        {active ? (
          <span
            aria-hidden="true"
            className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-brand-700 shadow-[0_0_6px_0_rgb(15_118_110_/_0.4)]"
          />
        ) : null}
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-colors",
            active
              ? "text-brand-700"
              : "text-text-subtle/80 group-hover:text-text-muted",
          )}
          aria-hidden
          strokeWidth={active ? 2 : 1.75}
        />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}

function SystemStatus({ healthy }: { healthy: boolean }) {
  const tNav = useTranslations("nav");
  const label = healthy ? tNav("systemHealthy") : tNav("systemDegraded");
  return (
    <div
      className="px-3 py-1.5 flex items-center gap-2 text-[11px] text-text-subtle"
      title={label}
      role="status"
      aria-live="polite"
    >
      <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden>
        {healthy ? (
          <>
            <span className="absolute inset-0 rounded-full bg-brand-500/60 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" />
          </>
        ) : (
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-warn-700" />
        )}
      </span>
      <span className="font-medium tracking-tight">{label}</span>
    </div>
  );
}
