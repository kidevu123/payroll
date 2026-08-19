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
import dynamic from "next/dynamic";
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
  Bell,
  Sparkles,
  ChevronDown,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { CommandTarget } from "@/components/admin/command-palette";
// Cmd+K palette — power-user modal, not needed for first paint. Load its
// chunk (and @radix-ui/react-dialog) after hydration instead of shipping it
// in every admin page's initial bundle.
const CommandPalette = dynamic(
  () => import("@/components/admin/command-palette").then((m) => m.CommandPalette),
  { ssr: false },
);
import { SignOutButton } from "@/components/admin/sign-out-button";
import { cn } from "@/lib/utils";
import { DASH } from "./theme";
import { ThemeToggle } from "./theme-toggle";

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
  badges,
  commandTargets,
  signOutLabel,
  footer,
  children,
}: {
  company: { name: string; logoPath: string | null };
  user: DarkShellUser;
  allowedSurfaces?: ReadonlyArray<string>;
  /** Pending-work counts keyed by nav href (e.g. `{ "/time": 2 }`).
   *  The badge sits on the section the work belongs to — missed punches on
   *  Time, time-off on Calendar, recent announcements on Notifications. */
  badges?: Record<string, number>;
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
        background: `radial-gradient(1100px 620px at 78% -8%, rgba(52,211,153,0.10), transparent 60%), ${DASH.bg}`,
        color: DASH.text,
      }}
    >
      {/* ── Mobile top bar (branding) — shown below md only; from md up the
          sidebar rail takes over and the bottom tab bar (MobileQuickNav)
          hides at the same breakpoint. */}
      <div
        className="md:hidden fixed inset-x-0 top-0 z-40 flex items-center gap-2.5 px-4"
        style={{
          height: "calc(3.5rem + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
          background: DASH.topbar,
          borderBottom: `1px solid ${DASH.border}`,
          backdropFilter: "blur(12px)",
        }}
      >
        {company.logoPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logoPath}
            alt={company.name}
            width={26}
            height={26}
            className="h-6 w-6 rounded-lg object-contain"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-6 w-6 items-center justify-center rounded-md text-[13px] font-black"
            style={{ background: DASH.accentGradient, color: DASH.onAccent }}
          >
            {company.name.slice(0, 1).toLowerCase()}
          </span>
        )}
        <span className="text-[15px] font-bold tracking-tight" style={{ color: DASH.text }}>
          {company.name}
        </span>
        {/* Right cluster: notifications + avatar (matches the mobile refs). */}
        <div className="ml-auto flex items-center gap-2">
          {/* Announcements bell. Mirrors the sidebar's Notifications badge —
              recent announcements (last 7 days) show as a count bubble. */}
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-full"
            style={{ color: DASH.textMuted, background: DASH.surfaceRaised }}
          >
            <Bell className="h-4 w-4" aria-hidden />
            {(badges?.["/notifications"] ?? 0) > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold tabular-nums"
                style={{ background: DASH.emerald, color: DASH.onAccent }}
              >
                {badges!["/notifications"]}
              </span>
            ) : null}
          </Link>
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
              style={{ background: DASH.accentGradient, color: DASH.onAccent }}
            >
              {initialsOf(user.name)}
            </span>
          )}
        </div>
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────
          Compact icon rail on tablet (md, w-16) → full sidebar on desktop
          (lg, w-64). Below md it's hidden and the mobile top bar + bottom
          tab bar take over. Labels/search/intelligence/profile-detail are
          gated to lg so the rail stays icon-only. */}
      <aside
        className="hidden md:flex fixed inset-y-0 left-0 z-30 w-16 lg:w-64 flex-col h-dvh"
        style={{
          background: DASH.sidebar,
          borderRight: `1px solid ${DASH.border}`,
          backdropFilter: "blur(12px)",
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-center lg:justify-start gap-2.5 px-0 lg:px-5 pt-5 pb-4 shrink-0">
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
                background: DASH.accentGradient,
                color: DASH.onAccent,
                boxShadow: "0 4px 14px -4px rgba(52,211,153,0.7)",
              }}
            >
              {company.name.slice(0, 1).toLowerCase()}
            </span>
          )}
          <span className="hidden lg:inline text-[17px] font-bold tracking-tight" style={{ color: DASH.text }}>
            {company.name}
          </span>
          <ThemeToggle className="ml-auto hidden lg:inline-flex" />
        </div>

        {/* Search — full sidebar only; Cmd+K still works on the rail. */}
        <div className="hidden lg:block px-3 pb-3 shrink-0">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition-colors"
            style={{
              background: DASH.search,
              border: `1px solid ${DASH.border}`,
              color: DASH.textMuted,
            }}
          >
            <Search className="h-4 w-4" style={{ color: DASH.textFaint }} aria-hidden />
            <span className="flex-1 text-left">{tNav("search")}</span>
            <kbd
              className="rounded-md px-1.5 py-0.5 font-mono text-[10px]"
              style={{ background: DASH.hover, color: DASH.textFaint }}
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
                className="hidden lg:block px-2 mb-1.5 text-micro uppercase"
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
                    badge={(badges?.[href] ?? 0) > 0 ? badges![href]! : null}
                  />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Intelligence card → Assistant — full sidebar only; the rail
            already carries the Assistant nav icon. */}
        <div className="hidden lg:block px-3 pb-3 shrink-0">
          <div
            className="rounded-xl p-3.5"
            style={{
              background: "linear-gradient(160deg, rgba(52,211,153,0.16), rgba(52,211,153,0.04))",
              border: `1px solid ${DASH.borderStrong}`,
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: DASH.emerald }} aria-hidden />
              <span className="text-[13px] font-bold" style={{ color: DASH.text }}>
                {company.name} Intelligence
              </span>
              <span
                className="rounded px-1.5 py-px text-micro uppercase"
                style={{ background: "rgba(52,211,153,0.25)", color: DASH.emerald }}
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
              style={{ background: DASH.emerald, color: DASH.onAccent }}
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
              className="flex w-full items-center justify-center lg:justify-start gap-0 lg:gap-2.5 rounded-xl px-0 lg:px-2 py-2 transition-colors"
              style={{ background: menuOpen ? DASH.hover : "transparent" }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={user.name}
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
                  style={{ background: DASH.accentGradient, color: DASH.onAccent }}
                >
                  {initialsOf(user.name)}
                </span>
              )}
              <span className="hidden lg:block min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-semibold" style={{ color: DASH.text }}>
                  {user.name}
                </span>
                <span className="block truncate text-micro uppercase" style={{ color: DASH.textFaint }}>
                  {user.role}
                </span>
              </span>
              <ChevronDown className="hidden lg:block h-4 w-4 shrink-0" style={{ color: DASH.textFaint }} aria-hidden />
            </button>
            {/* On the rail the sidebar is only 64px wide, so the menu flies
                out to the right of the avatar; from lg it spans the sidebar
                width as before. */}
            {menuOpen ? (
              <div
                role="menu"
                className="absolute bottom-12 left-0 z-40 w-56 overflow-hidden rounded-xl lg:w-auto lg:right-0"
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
          {/* Version marker — always visible, kept out of the content column so
              the dashboard still fits one screen. */}
          <div
            className="hidden lg:flex items-center justify-center gap-1.5 pt-0.5 text-[10px]"
            style={{ color: DASH.textFaint }}
            title={`Server time ${footer.serverTime} · Made by your haute tech team`}
          >
            <a
              href={`https://github.com/kidevu123/payroll/commit/${footer.shaFull}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:underline"
              style={{ color: DASH.textMuted }}
            >
              {footer.sha}
            </a>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{footer.serverTime}</span>
          </div>
        </div>
      </aside>

      {/* ── Canvas ──────────────────────────────────────────────── */}
      {/* md clears the 4rem icon rail; lg the full 16rem sidebar. The mobile
          top/bottom fixed bars hide from md up, so their pt/pb offsets reset
          to plain py-4 at the same breakpoint. */}
      <main className="md:pl-16 lg:pl-64 min-h-dvh">
        {/* Content column caps at 1440px. It was 1800px, which on a wide
            monitor stretched list rows into a name on the far left and a
            status chip on the far right with a lake of dead space between.
            Measured comparison: Stripe docs ~1175, shadcn ~1214, Geist 1220,
            Linear ~1344.

            Desktop bottom padding clears the fixed FeedbackLauncher (bottom-4
            right-4, z-30). With md:pb-4 the launcher sat directly on top of
            whatever rendered in the canvas's bottom-right corner — on /reports
            that was the primary "Generate custom report" CTA. */}
        <div className="mx-auto w-full max-w-[min(1440px,100%)] px-4 pt-[calc(3.75rem+env(safe-area-inset-top))] pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:px-6 md:py-4 md:pt-4 md:pb-16 2xl:px-10">
          {children}
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
      {/* Icon-only on the tablet rail (label hidden, native title as the
          tooltip, badge collapses to a dot); full row with label + count
          pill from lg up. */}
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        title={label}
        className={cn(
          "group relative flex items-center justify-center lg:justify-start gap-0 lg:gap-3 rounded-xl px-0 lg:px-3 py-2 text-[13px] font-semibold transition-colors",
        )}
        style={
          active
            ? { background: "rgba(52,211,153,0.16)", color: DASH.text }
            : { color: DASH.textMuted }
        }
      >
        {active ? (
          <span
            aria-hidden
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
            style={{ background: DASH.emerald, boxShadow: "0 0 8px 0 rgba(52,211,153,0.6)" }}
          />
        ) : null}
        <Icon
          className="h-[18px] w-[18px] shrink-0"
          style={{ color: active ? DASH.emerald : DASH.textFaint }}
          strokeWidth={active ? 2 : 1.75}
          aria-hidden
        />
        <span className="hidden lg:block flex-1 truncate">{label}</span>
        {badge !== null ? (
          <>
            <span
              aria-hidden
              className="lg:hidden absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
              style={{ background: DASH.emerald }}
            />
            <span
              className="hidden lg:inline rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums"
              style={{ background: "rgba(52,211,153,0.3)", color: DASH.emerald }}
            >
              {badge}
            </span>
          </>
        ) : null}
      </Link>
    </li>
  );
}
