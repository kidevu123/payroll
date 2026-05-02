"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CalendarRange,
  CalendarClock,
  Calculator,
  Layers,
  Workflow,
  Bell,
  ShieldCheck,
  PartyPopper,
  Clock4,
  Image as ImageIcon,
  CircleDollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/company", label: "Company", icon: Building2 },
  { href: "/settings/branding", label: "Branding", icon: ImageIcon },
  { href: "/settings/pay-periods", label: "Pay periods", icon: CalendarRange },
  { href: "/settings/pay-schedules", label: "Pay schedules", icon: CalendarClock },
  { href: "/settings/pay-rules", label: "Pay rules", icon: Calculator },
  { href: "/settings/shifts", label: "Shifts", icon: Layers },
  { href: "/settings/automation", label: "Automation", icon: Clock4 },
  { href: "/settings/ngteco", label: "NGTeco", icon: Workflow },
  { href: "/settings/zoho", label: "Zoho", icon: CircleDollarSign },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/security", label: "Security", icon: ShieldCheck },
  { href: "/settings/holidays", label: "Holidays", icon: PartyPopper },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-6 self-start">
          <ul className="space-y-0.5">
            {TABS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-input text-sm",
                      active
                        ? "bg-brand-50 text-brand-700 font-medium"
                        : "text-text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <section>{children}</section>
      </div>
    </div>
  );
}
