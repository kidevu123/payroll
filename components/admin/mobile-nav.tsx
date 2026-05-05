"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Wallet,
  MessageSquareWarning,
  BarChart3,
  Settings2,
  Briefcase,
  CalendarRange,
  Menu,
  X,
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
      { href: "/calendar", labelKey: "calendar", icon: CalendarRange },
      { href: "/requests", labelKey: "requests", icon: MessageSquareWarning },
    ],
  },
  {
    headingKey: "operate",
    items: [{ href: "/reports", labelKey: "reports", icon: BarChart3 }],
  },
  {
    headingKey: "system",
    items: [{ href: "/settings", labelKey: "settings", icon: Settings2 }],
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
  const tNav = useTranslations("nav");
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
        aria-label={tNav("openNavigation")}
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
              <Wordmark name="Milo" logoPath={company.logoPath} size="md" showName={false} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={tNav("closeNavigation")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-input hover:bg-surface-2"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
              {SECTIONS.map((sec) => (
                <div key={sec.headingKey}>
                  <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                    {tNav(sec.headingKey)}
                  </div>
                  <ul className="space-y-0.5">
                    {sec.items.map(({ href, labelKey, icon: Icon }) => {
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
                            <span>{tNav(labelKey)}</span>
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
