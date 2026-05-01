// Bottom-nav for the employee PWA. Lucide icons, no emoji. Active state
// uses the brand accent.

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Calendar, Wallet, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/me/home", label: "Home", icon: Home },
  { href: "/me/time", label: "Time", icon: Calendar },
  { href: "/me/pay", label: "Pay", icon: Wallet },
  { href: "/me/profile", label: "Profile", icon: User },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Employee navigation"
      className="fixed bottom-0 inset-x-0 z-30 border-t border-[--border] bg-[--surface]/95 backdrop-blur supports-[backdrop-filter]:bg-[--surface]/80"
    >
      <ul className="grid grid-cols-4 max-w-md mx-auto">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-xs",
                  active ? "text-[--color-brand-700]" : "text-[--text-muted]",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
