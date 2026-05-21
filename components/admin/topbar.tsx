"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Search, ChevronRight, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { SignOutButton } from "./sign-out-button";
import { CommandPalette, type CommandTarget } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { LanguageSwitcher } from "./language-switcher";
import { cn } from "@/lib/utils";
import type { Surface } from "@/lib/auth/role-matrix";

const TITLE_KEY_MAP: Record<string, string> = {
  "/dashboard": "dashboard",
  "/employees": "employees",
  "/time": "time",
  "/payroll": "payroll",
  "/requests": "requests",
  "/ngteco": "ngteco",
  "/reports": "reports",
  "/cash-drawer": "cashDrawer",
  "/notifications": "notifications",
  "/audit": "audit",
  "/settings": "settings",
};

function titleKeyFor(
  pathname: string,
): { titleKey: string | null; rawTitle: string; crumbs: string[] } {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return { titleKey: "dashboard", rawTitle: "Dashboard", crumbs: [] };
  const head = "/" + segs[0];
  const titleKey = TITLE_KEY_MAP[head] ?? null;
  const rawTitle = segs[0]!;
  if (segs.length === 1) return { titleKey, rawTitle, crumbs: [] };
  // Build human-readable crumbs from the rest. Numeric-ish segments and
  // UUIDs are turned into a generic "details" label so the breadcrumb stays
  // legible without dragging the URL into the UI.
  const rest = segs.slice(1).map((s) => {
    if (/^[0-9a-f-]{8,}$/i.test(s) || /^\d+$/.test(s)) return null;
    return s.replace(/-/g, " ");
  });
  const crumbs = rest.filter((x): x is string => Boolean(x));
  return { titleKey, rawTitle, crumbs };
}

function initialsFor(email: string): string {
  // Email-derived initial(s). For "first.last@domain" → "FL"; otherwise → first letter.
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email.slice(0, 1).toUpperCase() || "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}

function roleLabel(role: string): string {
  const lower = role.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function Topbar({
  email,
  role,
  unreadCount,
  commandTargets,
  company,
  currentLocale,
  allowedSurfaces,
}: {
  email: string;
  role: string;
  unreadCount: number;
  commandTargets: CommandTarget[];
  company: { name: string; logoPath: string | null };
  currentLocale: "en" | "es";
  allowedSurfaces?: ReadonlyArray<Surface>;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const tNav = useTranslations("nav");
  const tAuth = useTranslations("auth");
  const { titleKey, rawTitle, crumbs } = titleKeyFor(pathname);
  const title = titleKey ? tNav(titleKey) : rawTitle;
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [userMenuOpen, setUserMenuOpen] = React.useState(false);
  const userMenuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setUserMenuOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  React.useEffect(() => {
    if (!userMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [userMenuOpen]);

  // Close menu on route change.
  React.useEffect(() => {
    setUserMenuOpen(false);
  }, [pathname]);

  const initials = initialsFor(email);
  const roleText = roleLabel(role);

  return (
    <>
      <div
        className={cn(
          // Premium chrome: hairline divider, light backdrop blur, subtle
          // bottom shadow that lifts the bar from the page (matches the
          // sidebar's softer separation language). 2px brand-tinted
          // accent gradient at the very top — adds color without
          // shouting (Vercel / Linear pattern).
          //
          // z-50: <main> uses .page-enter which animates a transform,
          // creating its own stacking context. Without an explicit
          // z-index here, the user-menu dropdown (z-40 inside topbar)
          // gets painted UNDER the page content where the panel
          // overlaps it — calendar month-nav showing through the
          // dropdown was the visible symptom. Lifting the whole
          // topbar to z-50 keeps every popover anchored from it
          // above page content regardless of route.
          "sticky top-0 z-50 h-14 border-b border-border bg-surface/95 backdrop-blur-md",
          "flex items-center gap-2 sm:gap-3 px-3 sm:px-4 lg:px-6",
          "shadow-[0_1px_0_0_rgb(9_9_11_/_0.04)]",
        )}
      >
        <MobileNav
          company={company}
          allowedSurfaces={allowedSurfaces}
          currentLocale={currentLocale}
        />
        <div className="min-w-0 flex items-center gap-2 shrink-0">
          <h1 className="text-sm font-semibold tracking-tight antialiased truncate">
            {title}
          </h1>
          {crumbs.map((c, i) => (
            <span
              key={`${c}-${i}`}
              className="hidden sm:inline-flex items-center gap-2 text-xs text-text-muted"
            >
              <ChevronRight className="h-3 w-3 text-text-subtle" aria-hidden />
              <span className="capitalize">{c}</span>
            </span>
          ))}
        </div>

        {/* Search — anchored center on wide screens, hidden on small. */}
        <div className="flex-1 hidden md:flex items-center justify-center px-4">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={cn(
              // Refined search trigger: hairline border that brightens on
              // hover, subtle inner highlight, brand-tinted focus ring.
              "inline-flex items-center gap-2.5 h-8 w-full max-w-sm px-3 rounded-full",
              "border border-border/80 bg-surface-2/50",
              "shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.8),0_1px_3px_0_rgb(15_23_42_/_0.05)]",
              "text-[12.5px] text-text-muted font-medium tracking-tight",
              "hover:bg-surface hover:border-border-strong/60 hover:text-text transition-all duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
            )}
            aria-label={tNav("openCommandPalette")}
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden />
            <span className="flex-1 text-left tracking-tight">{tNav("search")}</span>
            <kbd className="ml-1 inline-flex items-center gap-0.5 font-mono text-[10px] px-1.5 h-5 rounded-md border border-border/80 bg-surface-2/60 text-text-subtle">
              <span aria-label="Command">⌘</span>K
            </kbd>
          </button>
        </div>

        {/* Spacer for small screens so the right cluster pins to the edge. */}
        <div className="md:hidden flex-1" />

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={tNav("openCommandPalette")}
            className={cn(
              "md:hidden h-9 w-9 inline-flex items-center justify-center rounded-lg text-text-muted",
              "hover:bg-surface-2/70 hover:text-text transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
            )}
          >
            <Search className="h-[18px] w-[18px]" aria-hidden strokeWidth={1.75} />
          </button>

          <Link
            href="/calendar"
            aria-label={
              unreadCount > 0
                ? tNav("notificationsUnreadAriaLabel", { count: unreadCount })
                : tNav("notificationsAriaLabel")
            }
            className={cn(
              "relative h-9 w-9 inline-flex items-center justify-center rounded-lg text-text-muted",
              "hover:bg-surface-2/70 hover:text-text transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
            )}
          >
            <Bell className="h-[18px] w-[18px]" aria-hidden strokeWidth={1.75} />
            {unreadCount > 0 ? (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-danger-700 text-white text-[10px] font-semibold flex items-center justify-center font-mono tabular-nums shadow-[0_0_0_2px_rgb(255_255_255)]"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>

          <div className="hidden sm:block">
            <LanguageSwitcher current={currentLocale} />
          </div>

          {/* User menu */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label={tNav("userMenu")}
              className={cn(
                "h-9 inline-flex items-center gap-2 pl-1 pr-2 rounded-input hover:bg-surface-2 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
              )}
            >
              <span
                aria-hidden
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-brand-fg text-[11px] font-bold tracking-tight shadow-[0_0_0_2px_rgb(255_255_255),0_0_0_3px_rgb(15_118_110_/_0.3)]"
              >
                {initials}
              </span>
              <span className="hidden lg:flex flex-col items-start leading-tight max-w-[160px]">
                <span className="text-xs truncate w-full text-text" title={email}>
                  {email}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-text-subtle">
                  {roleText}
                </span>
              </span>
              <ChevronDown className="hidden lg:block h-3.5 w-3.5 text-text-subtle" aria-hidden />
            </button>

            {userMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-11 z-40 w-64 rounded-card border border-border bg-surface shadow-pop overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border/70 flex items-center gap-3">
                  <span
                    aria-hidden
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-brand-fg text-xs font-bold tracking-tight shadow-[0_0_0_2px_rgb(255_255_255),0_0_0_3.5px_rgb(15_118_110_/_0.3)]"
                  >
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs truncate text-text" title={email}>
                      {email}
                    </div>
                    <div className="mt-0.5 inline-flex items-center rounded-chip border border-border/80 bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                      {roleText}
                    </div>
                  </div>
                </div>
                <SignOutButton label={tAuth("signOut")} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        targets={commandTargets}
        onSelect={(href) => {
          setPaletteOpen(false);
          router.push(href);
        }}
      />
    </>
  );
}
