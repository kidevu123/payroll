// Bottom-nav for the employee PWA. Lucide icons, no emoji. Active state
// uses the brand accent and a 2px notch above the icon — a tiny touch that
// makes the active tab feel anchored without an animated underline.
//
// Salaried employees don't punch in/out — their Time tab would show empty
// state forever, so we hide it via the `hideTime` flag the layout passes
// in based on the session user's payType.

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, CalendarDays, Wallet, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// `tour` is the data-tour attribute the AppTour walkthrough targets.
// Stable string keys that don't change with translations.
const ALL_TABS = [
  { href: "/me/home", labelKey: "home", icon: Home, tour: "nav-home" },
  { href: "/me/time", labelKey: "time", icon: Calendar, tour: "nav-time" },
  { href: "/me/calendar", labelKey: "calendar", icon: CalendarDays, tour: "nav-calendar" },
  { href: "/me/pay", labelKey: "pay", icon: Wallet, tour: "nav-pay" },
  { href: "/me/profile", labelKey: "profile", icon: User, tour: "nav-profile" },
] as const;

export function BottomNav({ hideTime = false }: { hideTime?: boolean }) {
  const t = useTranslations("employee.tabs");
  const tabs = hideTime
    ? ALL_TABS.filter((tab) => tab.href !== "/me/time")
    : ALL_TABS;
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Employee navigation"
      className="no-print fixed bottom-0 inset-x-0 z-30 border-t border-border/70 bg-surface/95 backdrop-blur-md supports-[backdrop-filter]:bg-surface/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_0_rgb(9_9_11_/_0.04),0_-8px_24px_-12px_rgb(9_9_11_/_0.08)]"
    >
      <ul
        className={cn(
          "grid max-w-md sm:max-w-2xl mx-auto",
          hideTime ? "grid-cols-4" : "grid-cols-5",
        )}
      >
        {tabs.map(({ href, labelKey, icon: Icon, tour }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                data-tour={tour}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[3.25rem] flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-colors",
                  active ? "text-brand-700 font-medium" : "text-text-subtle hover:text-text",
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-brand-700"
                  />
                ) : null}
                <Icon
                  className={cn(
                    "h-5 w-5 transition-transform",
                    active ? "scale-110" : "",
                  )}
                  aria-hidden="true"
                />
                <span>{t(labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
