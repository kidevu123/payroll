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
  Menu,
  X,
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
  {
    heading: "System",
    items: [{ href: "/settings", label: "Settings", icon: Settings2 }],
  },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Mobile-only nav. Hamburger button (top-left) opens a slide-in drawer
 * that mirrors the desktop sidebar's navigation. Hidden on lg+ so the
 * desktop sidebar takes over.
 */
export function MobileNav({
  company,
}: {
  company: { name: string; logoPath: string | null };
}) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = React.useState(false);

  // Close drawer on route change.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while open.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-input hover:bg-surface-2"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </button>

      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
              <Wordmark name={company.name} logoPath={company.logoPath} size="md" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="inline-flex h-9 w-9 items-center justify-center rounded-input hover:bg-surface-2"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
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
                              "flex items-center gap-3 px-3 py-2.5 rounded-input text-sm",
                              active
                                ? "bg-brand-50 text-brand-800 font-medium"
                                : "text-text-muted hover:bg-surface-2 hover:text-text",
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" aria-hidden />
                            <span>{label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}
