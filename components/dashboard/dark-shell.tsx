// Full-screen DARK shell for the showcase dashboard ONLY.
//
// The rest of the admin app renders the light Sidebar + Topbar. The dashboard
// route swaps to this cohesive dark frame (sidebar + canvas as one surface) so
// the whole screen reads as one premium dark app — matching the owner's
// reference. It carries the REAL nav (same items/icons/translations as the
// light sidebar) and the real command palette + sign-out.

"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  Wallet,
  BarChart3,
  ClipboardCheck,
  Bot,
  Settings2,
  Briefcase,
  CalendarRange,
  Banknote,
  Megaphone,
  Search,
  Sparkles,
  ChevronDown,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { CommandPalette, type CommandTarget } from "@/components/admin/command-palette";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { cn } from "@/lib/utils";
import { DASH } from "./theme";

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
      { href: "/assistant", labelKey: "assistant", icon: Bot },
      { href: "/reports", labelKey: "reports", icon: BarChart3 },
      { href: "/cash-drawer", labelKey: "cashDrawer", icon: Banknote },
      { href: "/notifications", labelKey: "notifications", icon: Megaphone },
    ],
  },
];

const FOOTER_NAV: NavItem = { href: "/settings", labelKey: "settings", icon: Settings2 };

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export type DarkShellUser = {
  name: string;
  role: string;
  email: string;
  avatarUrl: string | null;
};

export function DashboardDarkShell({
  company,
  user,
  allowedSurfaces,
  unreadCount,
  commandTargets,
  signOutLabel,
  footer,
  children,
}: {
  company: { name: string; logoPath: string | null };
  user: DarkShellUser;
  allowedSurfaces?: ReadonlyArray<string>;
  unreadCount: number;
  commandTargets: CommandTarget[];
  signOutLabel: string;
  /** Build/version info for the footer line (SHA + server time). */
  footer: { sha: string; shaFull: string; serverTime: string };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const tNav = useTranslations("nav");
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  const allowSet = allowedSurfaces ? new Set(allowedSurfaces) : null;
  const sections = SECTIONS.map((sec) => ({
    ...sec,
    items: allowSet ? sec.items.filter((it) => allowSet.has(it.href)) : sec.items,
  })).filter((sec) => sec.items.length > 0);
  const settingsAllowed = allowSet ? allowSet.has("/settings") : true;

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  return (
    <div
      className="min-h-dvh"
      style={{
        background: `radial-gradient(1100px 620px at 78% -8%, rgba(139,92,246,0.10), transparent 60%), ${DASH.bg}`,
        color: DASH.text,
      }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col h-dvh"
        style={{
          background: "rgba(13,13,20,0.72)",
          borderRight: `1px solid ${DASH.border}`,
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4 shrink-0">
          {company.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logoPath}
              alt={company.name}
              width={28}
              height={28}
              className="h-7 w-7 rounded-lg object-contain"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[15px] font-black"
              style={{
                background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
                color: "#0b0b12",
                boxShadow: "0 4px 14px -4px rgba(139,92,246,0.7)",
              }}
            >
              {company.name.slice(0, 1).toLowerCase()}
            </span>
          )}
          <span className="text-[17px] font-bold tracking-tight" style={{ color: DASH.text }}>
            {company.name}
          </span>
        </div>

        {/* Search */}
        <div className="px-3 pb-3 shrink-0">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition-colors"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${DASH.border}`,
              color: DASH.textMuted,
            }}
          >
            <Search className="h-4 w-4" style={{ color: DASH.textFaint }} aria-hidden />
            <span className="flex-1 text-left">{tNav("search")}</span>
            <kbd
              className="rounded-md px-1.5 py-0.5 font-mono text-[10px]"
              style={{ background: "rgba(255,255,255,0.06)", color: DASH.textFaint }}
            >
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-5 overflow-y-auto pb-4">
          {sections.map((sec) => (
            <div key={sec.headingKey}>
              <div
                className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ color: DASH.textFaint }}
              >
                {tNav(sec.headingKey)}
              </div>
              <ul className="space-y-0.5">
                {sec.items.map(({ href, labelKey, icon: Icon }) => (
                  <DarkNavItem
                    key={href}
                    href={href}
                    label={tNav(labelKey)}
                    Icon={Icon}
                    active={isActive(pathname, href)}
                    badge={href === "/notifications" && unreadCount > 0 ? unreadCount : null}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Intelligence card → Assistant */}
        <div className="px-3 pb-3 shrink-0">
          <div
            className="rounded-2xl p-3.5"
            style={{
              background: "linear-gradient(160deg, rgba(139,92,246,0.16), rgba(139,92,246,0.04))",
              border: `1px solid ${DASH.borderStrong}`,
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: DASH.violetBright }} aria-hidden />
              <span className="text-[13px] font-bold" style={{ color: DASH.text }}>
                {company.name} Intelligence
              </span>
              <span
                className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
                style={{ background: "rgba(139,92,246,0.25)", color: DASH.violetBright }}
              >
                Beta
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-snug" style={{ color: DASH.textMuted }}>
              Ask anything about your payroll, team, or operations.
            </p>
            <Link
              href="/assistant"
              className="mt-2.5 flex w-full items-center justify-center rounded-lg py-1.5 text-[12px] font-semibold"
              style={{ background: DASH.violetBright, color: "#0b0b12" }}
            >
              Ask {company.name}
            </Link>
          </div>
        </div>

        {/* Footer: settings + profile */}
        <div className="px-3 pb-4 shrink-0 space-y-1" style={{ borderTop: `1px solid ${DASH.border}` }}>
          {settingsAllowed ? (
            <div className="pt-2">
              <DarkNavItem
                href={FOOTER_NAV.href}
                label={tNav(FOOTER_NAV.labelKey)}
                Icon={FOOTER_NAV.icon}
                active={isActive(pathname, FOOTER_NAV.href)}
                badge={null}
              />
            </div>
          ) : null}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 transition-colors"
              style={{ background: menuOpen ? "rgba(255,255,255,0.05)" : "transparent" }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt={user.name}
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: "linear-gradient(135deg, #a78bfa, #7c3aed)", color: "#0b0b12" }}
                >
                  {initialsOf(user.name)}
                </span>
              )}
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-semibold" style={{ color: DASH.text }}>
                  {user.name}
                </span>
                <span className="block truncate text-[10px] uppercase tracking-wide" style={{ color: DASH.textFaint }}>
                  {user.role}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 shrink-0" style={{ color: DASH.textFaint }} aria-hidden />
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute bottom-12 left-0 right-0 z-40 overflow-hidden rounded-xl"
                style={{ background: DASH.surfaceRaised, border: `1px solid ${DASH.borderStrong}` }}
              >
                <div className="px-3 py-2 text-[11px] truncate" style={{ color: DASH.textFaint }}>
                  {user.email}
                </div>
                <div style={{ borderTop: `1px solid ${DASH.border}` }}>
                  <div className="flex items-center gap-2 px-1 text-[13px]" style={{ color: DASH.text }}>
                    <LogOut className="ml-2 h-4 w-4" style={{ color: DASH.textMuted }} aria-hidden />
                    <SignOutButton label={signOutLabel} />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      {/* ── Canvas ──────────────────────────────────────────────── */}
      <main className="lg:pl-64 min-h-dvh">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6 sm:py-5">
          {children}
          <footer
            className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 py-3 text-[11px]"
            style={{ color: DASH.textFaint }}
          >
            <a
              href={`https://github.com/kidevu123/payroll/commit/${footer.shaFull}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:underline"
              style={{ color: DASH.textMuted }}
              title="View commit on GitHub"
            >
              {footer.sha}
            </a>
            <span aria-hidden="true">·</span>
            <span className="font-mono">Server time {footer.serverTime}</span>
            <span aria-hidden="true">·</span>
            <span>Made by your haute tech team</span>
          </footer>
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        targets={commandTargets}
        onSelect={(href) => {
          setPaletteOpen(false);
          router.push(href);
        }}
      />
    </div>
  );
}

function DarkNavItem({
  href,
  label,
  Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  badge: number | null;
}) {
  return (
    <li className="list-none">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-semibold transition-colors",
        )}
        style={
          active
            ? { background: "rgba(139,92,246,0.16)", color: DASH.text }
            : { color: DASH.textMuted }
        }
      >
        {active ? (
          <span
            aria-hidden
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
            style={{ background: DASH.violetBright, boxShadow: "0 0 8px 0 rgba(139,92,246,0.6)" }}
          />
        ) : null}
        <Icon
          className="h-[18px] w-[18px] shrink-0"
          style={{ color: active ? DASH.violetBright : DASH.textFaint }}
          strokeWidth={active ? 2 : 1.75}
          aria-hidden
        />
        <span className="flex-1 truncate">{label}</span>
        {badge !== null ? (
          <span
            className="rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums"
            style={{ background: "rgba(139,92,246,0.3)", color: DASH.violetBright }}
          >
            {badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
