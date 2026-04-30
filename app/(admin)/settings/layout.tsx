import Link from "next/link";
import {
  Building2,
  CalendarRange,
  Calculator,
  Layers,
  Workflow,
  Bell,
  ShieldCheck,
  PartyPopper,
  Clock4,
} from "lucide-react";

const TABS = [
  { href: "/settings/company", label: "Company", icon: Building2 },
  { href: "/settings/pay-periods", label: "Pay periods", icon: CalendarRange },
  { href: "/settings/pay-rules", label: "Pay rules", icon: Calculator },
  { href: "/settings/shifts", label: "Shifts", icon: Layers },
  { href: "/settings/automation", label: "Automation", icon: Clock4 },
  { href: "/settings/ngteco", label: "NGTeco", icon: Workflow },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/security", label: "Security", icon: ShieldCheck },
  { href: "/settings/holidays", label: "Holidays", icon: PartyPopper },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-[--text-muted]">
          Every operational behavior lives here. Change a value, the system follows.
        </p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-6 self-start">
          <ul className="space-y-0.5">
            {TABS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="flex items-center gap-3 px-3 py-2 rounded-[--radius-input] text-sm text-[--text-muted] hover:bg-[--surface-2] hover:text-[--text]"
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section>{children}</section>
      </div>
    </div>
  );
}
