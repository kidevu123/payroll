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
  Users,
  CalendarDays,
  Wallet,
  MessageSquareWarning,
  Workflow,
  BarChart3,
  ScrollText,
  Settings2,
  Briefcase,
  CalendarRange,
  Database,
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
      { href: "/employees", labelKey: "employees", icon: Users },
      { href: "/time", labelKey: "time", icon: CalendarDays },
      { href: "/payroll", labelKey: "payroll", icon: Wallet },
      { href: "/salaried", labelKey: "salaried", icon: Briefcase },
      { href: "/calendar", labelKey: "calendar", icon: CalendarRange },
      { href: "/requests", labelKey: "requests", icon: MessageSquareWarning },
    ],
  },
  {
    headingKey: "operate",
    items: [
      { href: "/ngteco", labelKey: "ngteco", icon: Workflow },
      { href: "/reports", labelKey: "reports", icon: BarChart3 },
      { href: "/audit", labelKey: "audit", icon: ScrollText },
      { href: "/db", labelKey: "database", icon: Database },
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
}: {
  company: { name: string; logoPath: string | null };
  systemHealthy?: boolean;
}) {
  const pathname = usePathname() ?? "";
  const tNav = useTranslations("nav");

  return (
    <aside
      className={cn(
        // Soft right divider via a tinted border (color-mix style) instead
        // of a hard solid line — premium SaaS sidebars rarely use a
        // visible 1px border. Slight inset shadow keeps separation.
        "hidden lg:flex w-64 shrink-0 flex-col bg-surface/95 backdrop-blur",
        "border-r border-border/60 sticky top-0 h-dvh",
        "shadow-[1px_0_0_0_rgb(15_23_42_/_0.02),inset_-1px_0_0_0_rgb(15_23_42_/_0.01)]",
      )}
    >
      {/* Wordmark slot. Glyph rendered raw (no tile) next to "Milo" so it
          reads as type, not a sticker. min-h guard against the
          invisible-logo bug. */}
      <div className="px-5 pt-5 pb-5 shrink-0 min-h-[56px] flex items-center">
        <Wordmark
          name="Milo"
          logoPath={company.logoPath}
          size="md"
          className="min-w-0"
        />
      </div>

      <nav className="flex-1 px-3 space-y-5 overflow-y-auto pb-4">
        {SECTIONS.map((sec) => (
          <div key={sec.headingKey}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-subtle/80">
              {tNav(sec.headingKey)}
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

      <div className="px-3 pb-3 pt-3 border-t border-border/50 shrink-0 space-y-1">
        <SidebarItem
          href={FOOTER_NAV.href}
          label={tNav(FOOTER_NAV.labelKey)}
          Icon={FOOTER_NAV.icon}
          active={isActive(pathname, FOOTER_NAV.href)}
        />
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
          // Premium item base: tighter type, refined radius + spacing.
          "group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium tracking-tight transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
          active
            ? // Active: desaturated brand tint + crisp left bar + brand icon.
              // Inner highlight gives the surface a "pressed in" feel.
              "bg-brand-50/70 text-brand-900 shadow-[inset_0_0_0_1px_rgb(15_118_110_/_0.08)]"
            : "text-text-muted hover:bg-surface-2/70 hover:text-text",
        )}
      >
        {active ? (
          <span
            aria-hidden="true"
            className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-r-full bg-brand-700"
          />
        ) : null}
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-colors",
            active
              ? "text-brand-700"
              : "text-text-subtle group-hover:text-text",
          )}
          aria-hidden
          strokeWidth={1.75}
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
