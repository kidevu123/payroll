// Admin sidebar — sectioned nav with active accent. Lucide icons only (§9).
// Top-level groups follow the operator's mental model: Overview / Manage /
// Operate / Settings sit at the foot. Active route gets a 2-px brand bar on
// the left and the brand-50 surface treatment so the eye lands on it before
// reading the label.

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
  Circle,
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
      { href: "/requests", label: "Requests", icon: MessageSquareWarning },
    ],
  },
  {
    heading: "Operate",
    items: [
      { href: "/ngteco", label: "NGTeco", icon: Workflow },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/audit", label: "Audit", icon: ScrollText },
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
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="px-5 pt-5 pb-6">
        <Wordmark name={company.name} logoPath={company.logoPath} size="md" />
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
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2 rounded-input text-sm transition-colors",
                        active
                          ? "bg-brand-50 text-brand-800 font-medium"
                          : "text-text-muted hover:bg-surface-2 hover:text-text",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-brand-700"
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

      <div className="px-3 pb-3 pt-4 border-t border-border">
        <Link
          href={FOOTER_NAV.href}
          className={cn(
            "flex items-center gap-3 px-3 py-2 rounded-input text-sm",
            isActive(pathname, FOOTER_NAV.href)
              ? "bg-brand-50 text-brand-800 font-medium"
              : "text-text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          <FOOTER_NAV.icon className="h-4 w-4 text-text-subtle" aria-hidden />
          {FOOTER_NAV.label}
        </Link>
        <div
          className="mt-2 px-3 py-2 flex items-center gap-2 text-xs text-text-muted"
          title={systemHealthy ? "System healthy" : "System degraded"}
        >
          <Circle
            className={cn(
              "h-2 w-2 fill-current",
              systemHealthy ? "text-success-700" : "text-warn-700",
            )}
            aria-hidden
          />
          <span>{systemHealthy ? "All systems normal" : "System degraded"}</span>
        </div>
      </div>
    </aside>
  );
}
