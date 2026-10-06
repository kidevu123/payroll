"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  KeySquare,
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
  { href: "/settings/sso", label: "Single sign-on", icon: KeySquare },
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

export function SettingsNav({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeHref =
    CONFIG_TABS.find(
      (t) => pathname === t.href || pathname.startsWith(`${t.href}/`),
    )?.href ?? "";
  return (
    <div className="space-y-4 lg:space-y-6">
      <header className="page-header-rule pb-4">
        <h1 className="text-title tracking-tight antialiased text-text">
          Settings
        </h1>
        <p className="text-body text-text-muted mt-1 max-w-2xl">
          Company profile, pay rules, integrations, and admin tools.
        </p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5 lg:gap-8">
        {/* Below lg the 21-link list sat above every settings page — about
            900px of scrolling before the form. A native picker does the same
            job in one 44px row and uses the platform's own wheel. */}
        <div className="lg:hidden">
          <label
            htmlFor="settings-section"
            className="mb-1.5 block text-micro uppercase text-text-subtle"
          >
            Section
          </label>
          <select
            id="settings-section"
            value={activeHref}
            onChange={(e) => {
              if (e.target.value) router.push(e.target.value);
            }}
            className="h-11 w-full rounded-input border border-border bg-surface px-3 text-body font-medium text-text shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60"
          >
            {activeHref === "" && <option value="">Choose a section</option>}
            <optgroup label="Settings">
              {CONFIG_TABS.map((t) => (
                <option key={t.href} value={t.href}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Admin tools">
              {TOOL_TABS.map((t) => (
                <option key={t.href} value={t.href}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <nav
          aria-label="Settings sections"
          className="hidden lg:block lg:sticky lg:top-6 self-start rounded-card border border-border/70 bg-surface p-2 shadow-card space-y-3"
        >
          <ul className="space-y-0.5">
            {CONFIG_TABS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-2 rounded-input text-body border-l-2 transition-colors",
                      active
                        ? "border-brand-700 bg-brand-50/80 text-brand-800 font-medium"
                        : "border-transparent text-text-muted hover:bg-surface-2/40 hover:text-text",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border/60 mx-1" />
          <div>
            <div className="px-3 mb-1.5 text-micro uppercase text-text-subtle">
              Admin tools
            </div>
            <ul className="space-y-0.5">
              {TOOL_TABS.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-input text-body border-l-2 border-transparent text-text-muted hover:bg-surface-2/40 hover:text-text transition-colors"
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <section className="min-w-0 space-y-6">{children}</section>
      </div>
    </div>
  );
}
