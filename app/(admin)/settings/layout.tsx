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
  CalendarCheck,
  Wrench,
  Users,
  ScrollText,
  Database,
  Clock,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = { href: string; label: string; icon: LucideIcon };

const CONFIG_TABS: readonly Tab[] = [
  { href: "/settings/company", label: "Company", icon: Building2 },
  { href: "/settings/branding", label: "Branding", icon: ImageIcon },
  { href: "/settings/pay-periods", label: "Pay periods", icon: CalendarRange },
  { href: "/settings/pay-schedules", label: "Pay schedules", icon: CalendarClock },
  { href: "/settings/pay-rules", label: "Pay rules", icon: Calculator },
  { href: "/settings/shifts", label: "Shifts", icon: Layers },
  { href: "/settings/automation", label: "Automation", icon: Clock4 },
  { href: "/settings/ngteco", label: "NGTeco", icon: Workflow },
  { href: "/settings/zoho", label: "Zoho Books", icon: CircleDollarSign },
  { href: "/settings/google-calendar", label: "Google Calendar", icon: CalendarCheck },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/security", label: "Security", icon: ShieldCheck },
  { href: "/settings/roles", label: "Roles & access", icon: KeyRound },
  { href: "/settings/holidays", label: "Holidays", icon: PartyPopper },
  { href: "/settings/cleanup", label: "Data cleanup", icon: Wrench },
] as const;

// Admin-tool screens — full pages of their own, but the user wants them
// tucked under Settings rather than top-level sidebar items so the sidebar
// stays focused on day-to-day payroll work. These links navigate AWAY from
// the Settings shell; that's fine — the sidebar's Settings entry brings
// the admin back here.
const TOOL_TABS: readonly Tab[] = [
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/punches", label: "All punches", icon: Clock },
  { href: "/ngteco", label: "NGTeco runs", icon: Workflow },
  { href: "/audit", label: "Audit log", icon: ScrollText },
  { href: "/db", label: "Database", icon: Database },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-6 self-start space-y-4">
          <ul className="space-y-0.5">
            {CONFIG_TABS.map(({ href, label, icon: Icon }) => {
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
          <div className="border-t border-border/60" />
          <div>
            <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-subtle/80">
              Admin tools
            </div>
            <ul className="space-y-0.5">
              {TOOL_TABS.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex items-center gap-3 px-3 py-2 rounded-input text-sm text-text-muted hover:bg-surface-2 hover:text-text"
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <section>{children}</section>
      </div>
    </div>
  );
}
