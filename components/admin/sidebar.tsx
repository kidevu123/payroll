// Admin sidebar — exact tab list per §8.2. Lucide icons only (§9). No emoji.

import Link from "next/link";
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Wallet,
  MessageSquareWarning,
  Workflow,
  BarChart3,
  Settings2,
} from "lucide-react";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/employees", label: "Employees", icon: Users },
  { href: "/time", label: "Time", icon: CalendarDays },
  { href: "/payroll", label: "Payroll", icon: Wallet },
  { href: "/requests", label: "Requests", icon: MessageSquareWarning },
  { href: "/ngteco", label: "NGTeco", icon: Workflow },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;

export function Sidebar() {
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-[--border] bg-[--surface] py-4">
      <div className="px-5 mb-6">
        <span className="font-semibold tracking-tight">Payroll</span>
      </div>
      <nav className="flex-1 px-2 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-3 py-2 rounded-[--radius-input] text-sm text-[--text-muted] hover:bg-[--surface-2] hover:text-[--text]"
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
