// Admin sidebar — sectioned nav with active accent. Lucide icons only (§9).
// Top-level groups follow the operator's mental model: Overview / Manage /
// Operate / Settings sit at the foot. Active route gets a brand-tinted
// surface treatment + a 2-px brand bar on the left so the eye lands on it
// before reading the label. The wordmark slot has explicit min dimensions
// so a missing/late logo asset can never collapse the header to zero
// height (the "invisible logo" bug from the v6 deploy).

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
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";

type NavItem = { href: string; label: string; icon: LucideIcon };

const SECTIONS: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    heading: "Manage",
    items: [
      { href: "/employees", label: "Employees", icon: Users },
      { href: "/time", label: "Time", icon: CalendarDays },
      { href: "/payroll", label: "Payroll", icon: Wallet },
      { href: "/salaried", label: "Salaried", icon: Briefcase },
      { href: "/calendar", label: "Calendar", icon: CalendarRange },
      { href: "/requests", label: "Requests", icon: MessageSquareWarning },
    ],
  },
  {
    heading: "Operate",
    items: [
      { href: "/ngteco", label: "NGTeco", icon: Workflow },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/audit", label: "Audit", icon: ScrollText },
      { href: "/db", label: "Database", icon: Database },
    ],
  },
];

const FOOTER_NAV: NavItem = {
  href: "/settings",
  label: "Settings",
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

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-surface sticky top-0 h-dvh">
      {/* Wordmark slot. Explicit min height so a missing/late-loading logo
          can never collapse the header to zero (regression guard for the
          invisible-logo bug). */}
      <div className="px-5 pt-5 pb-6 shrink-0 min-h-[64px] flex items-center">
        <span className="inline-flex min-w-32 min-h-8 items-center">
          {/* App is "Milo" — the company-uploaded logo is the glyph and
              "Milo" reads as the wordmark next to it. The company name
              still surfaces in /settings/branding + the topbar context. */}
          <Wordmark name="Milo" logoPath={company.logoPath} size="md" />
        </span>
      </div>

      <nav className="flex-1 px-3 space-y-6 overflow-y-auto">
        {SECTIONS.map((sec) => (
          <div key={sec.heading}>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
              {sec.heading}
            </div>
            <ul className="space-y-0.5">
              {sec.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2 rounded-input text-sm transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                        active
                          ? "bg-brand-50 text-brand-800 font-medium"
                          : "text-text-muted hover:bg-surface-2 hover:text-text",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-brand-700"
                        />
                      ) : null}
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active ? "text-brand-700" : "text-text-subtle",
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-3 pb-3 pt-4 border-t border-border shrink-0">
        <Link
          href={FOOTER_NAV.href}
          aria-current={isActive(pathname, FOOTER_NAV.href) ? "page" : undefined}
          className={cn(
            "relative flex items-center gap-3 px-3 py-2 rounded-input text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
            isActive(pathname, FOOTER_NAV.href)
              ? "bg-brand-50 text-brand-800 font-medium"
              : "text-text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          {isActive(pathname, FOOTER_NAV.href) ? (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-brand-700"
            />
          ) : null}
          <FOOTER_NAV.icon
            className={cn(
              "h-4 w-4",
              isActive(pathname, FOOTER_NAV.href) ? "text-brand-700" : "text-text-subtle",
            )}
            aria-hidden
          />
          {FOOTER_NAV.label}
        </Link>
        <SystemStatus healthy={systemHealthy} />
      </div>
    </aside>
  );
}

function SystemStatus({ healthy }: { healthy: boolean }) {
  return (
    <div
      className="mt-2 px-3 py-2 flex items-center gap-2 text-xs text-text-muted"
      title={healthy ? "System healthy" : "System degraded"}
      role="status"
      aria-live="polite"
    >
      <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
        {healthy ? (
          <>
            <span className="absolute inset-0 rounded-full bg-brand-500/60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-600" />
          </>
        ) : (
          <span className="relative inline-flex h-2 w-2 rounded-full bg-warn-700" />
        )}
      </span>
      <span>{healthy ? "All systems normal" : "System degraded"}</span>
    </div>
  );
}
