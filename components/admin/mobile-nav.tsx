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
  Settings2,
  Briefcase,
  CalendarRange,
  Banknote,
  Megaphone,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand/wordmark";
import { LanguageSwitcher } from "./language-switcher";
import type { Surface } from "@/lib/auth/role-matrix";

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
    ],
  },
  {
    headingKey: "operate",
    items: [
      { href: "/hall-monitor", labelKey: "hallMonitor", icon: ClipboardCheck },
      { href: "/reports", labelKey: "reports", icon: BarChart3 },
      { href: "/cash-drawer", labelKey: "cashDrawer", icon: Banknote },
      { href: "/notifications", labelKey: "notifications", icon: Megaphone },
    ],
  },
  {
    headingKey: "system",
    items: [{ href: "/settings", labelKey: "settings", icon: Settings2 }],
  },
];

const QUICK_NAV_HREFS = [
  "/dashboard",
  "/time",
  "/payroll",
  "/calendar",
  "/reports",
  "/cash-drawer",
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function useMobileNavData(allowedSurfaces?: ReadonlyArray<Surface> | undefined) {
  const allowSet = React.useMemo(
    () => (allowedSurfaces ? new Set(allowedSurfaces) : null),
    [allowedSurfaces],
  );
  const sections = React.useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: allowSet
          ? section.items.filter((item) => allowSet.has(item.href as Surface))
          : section.items,
      })).filter((section) => section.items.length > 0),
    [allowSet],
  );
  const allItems = React.useMemo(() => SECTIONS.flatMap((section) => section.items), []);
  const quickItems = React.useMemo(
    () =>
      QUICK_NAV_HREFS.flatMap((href) => {
        const item = allItems.find((candidate) => candidate.href === href);
        if (!item || (allowSet && !allowSet.has(item.href as Surface))) return [];
        return [item];
      }).slice(0, 4),
    [allItems, allowSet],
  );

  return { sections, quickItems };
}

function useDrawerState(pathname: string) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return { open, setOpen };
}

function MobileDrawer({
  company,
  currentLocale,
  sections,
  pathname,
  onClose,
}: {
  company: { name: string; logoPath: string | null };
  currentLocale: "en" | "es";
  sections: { headingKey: string; items: NavItem[] }[];
  pathname: string;
  onClose: () => void;
}) {
  const tNav = useTranslations("nav");

  return (
    <div
      className="lg:hidden fixed inset-0 z-[80] flex"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative flex h-dvh w-[min(20rem,calc(100vw-1rem))] flex-col border-r border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
          <Wordmark name="Milo" logoPath={company.logoPath} size="md" showName={false} />
          <button
            type="button"
            onClick={onClose}
            aria-label={tNav("closeNavigation")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-input hover:bg-surface-2"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6 overscroll-contain">
          {sections.map((sec) => (
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
        <div className="border-t border-border px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 sm:hidden">
          <LanguageSwitcher current={currentLocale} />
        </div>
      </aside>
    </div>
  );
}

export function MobileNav({
  company,
  allowedSurfaces,
  currentLocale,
}: {
  company: { name: string; logoPath: string | null };
  allowedSurfaces?: ReadonlyArray<Surface> | undefined;
  currentLocale: "en" | "es";
}) {
  const pathname = usePathname() ?? "";
  const tNav = useTranslations("nav");
  const { sections } = useMobileNavData(allowedSurfaces);
  const { open, setOpen } = useDrawerState(pathname);

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
        <MobileDrawer
          company={company}
          currentLocale={currentLocale}
          sections={sections}
          pathname={pathname}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function MobileQuickNav({
  company,
  allowedSurfaces,
  currentLocale,
}: {
  company: { name: string; logoPath: string | null };
  allowedSurfaces?: ReadonlyArray<Surface> | undefined;
  currentLocale: "en" | "es";
}) {
  const pathname = usePathname() ?? "";
  const tNav = useTranslations("nav");
  const { sections, quickItems } = useMobileNavData(allowedSurfaces);
  const { open, setOpen } = useDrawerState(pathname);

  return (
    <>
      {open && (
        <MobileDrawer
          company={company}
          currentLocale={currentLocale}
          sections={sections}
          pathname={pathname}
          onClose={() => setOpen(false)}
        />
      )}

      <nav
        aria-label={tNav("openNavigation")}
        className="lg:hidden fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4rem)] z-40 rounded-2xl border border-border/80 bg-surface/95 p-1.5 shadow-pop backdrop-blur-md"
      >
        <div className="grid grid-cols-5 items-stretch gap-1">
          {quickItems.map(({ href, labelKey, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-medium leading-tight",
                  active
                    ? "bg-brand-50 text-brand-800"
                    : "text-text-muted hover:bg-surface-2 hover:text-text",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="max-w-full truncate">{tNav(labelKey)}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={tNav("openNavigation")}
            className="flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-medium leading-tight text-text-muted hover:bg-surface-2 hover:text-text"
          >
            <Menu className="h-4 w-4 shrink-0" aria-hidden />
            <span>{tNav("menu")}</span>
          </button>
        </div>
      </nav>
    </>
  );
}
