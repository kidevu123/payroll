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
import { Home, Calendar, Wallet, User } from "lucide-react";
import { cn } from "@/lib/utils";

const ALL_TABS = [
  { href: "/me/home", label: "Home", icon: Home },
  { href: "/me/time", label: "Time", icon: Calendar },
  { href: "/me/pay", label: "Pay", icon: Wallet },
  { href: "/me/profile", label: "Profile", icon: User },
] as const;

export function BottomNav({ hideTime = false }: { hideTime?: boolean }) {
  const tabs = hideTime
    ? ALL_TABS.filter((t) => t.href !== "/me/time")
    : ALL_TABS;
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Employee navigation"
      className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={cn("grid max-w-md mx-auto", hideTime ? "grid-cols-3" : "grid-cols-4")}>
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] transition-colors",
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
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
