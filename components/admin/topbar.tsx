"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOutAction } from "./sign-out-action";
import { CommandPalette, type CommandTarget } from "./command-palette";
import { cn } from "@/lib/utils";

const TITLE_MAP: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/employees": "Employees",
  "/time": "Time",
  "/payroll": "Payroll",
  "/requests": "Requests",
  "/ngteco": "NGTeco",
  "/reports": "Reports",
  "/audit": "Audit",
  "/settings": "Settings",
};

function titleFor(pathname: string): { title: string; crumbs: string[] } {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return { title: "Dashboard", crumbs: [] };
  const head = "/" + segs[0];
  const root = TITLE_MAP[head] ?? segs[0]!;
  if (segs.length === 1) return { title: root, crumbs: [] };
  // Build human-readable crumbs from the rest. Numeric-ish segments and
  // UUIDs are turned into a generic "details" label so the breadcrumb stays
  // legible without dragging the URL into the UI.
  const rest = segs.slice(1).map((s) => {
    if (/^[0-9a-f-]{8,}$/i.test(s) || /^\d+$/.test(s)) return null;
    return s.replace(/-/g, " ");
  });
  const crumbs = rest.filter((x): x is string => Boolean(x));
  return { title: root, crumbs };
}

export function Topbar({
  email,
  role,
  unreadCount,
  commandTargets,
}: {
  email: string;
  role: string;
  unreadCount: number;
  commandTargets: CommandTarget[];
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { title, crumbs } = titleFor(pathname);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
      const cmd = isMac ? e.metaKey : e.ctrlKey;
      if (cmd && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="h-14 border-b border-border bg-surface flex items-center gap-3 px-4 lg:px-6">
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <h1 className="text-sm font-semibold tracking-tight truncate">
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

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className={cn(
            "hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-input border border-border bg-surface-2/60",
            "text-xs text-text-muted hover:bg-surface-2 hover:text-text transition-colors",
          )}
          aria-label="Open command palette"
        >
          <Search className="h-3.5 w-3.5" aria-hidden />
          <span>Search</span>
          <kbd className="ml-1 inline-flex items-center gap-0.5 font-mono text-[10px] px-1.5 py-0.5 rounded-chip border border-border bg-surface text-text-subtle">
            <span aria-label="Command">⌘</span>K
          </kbd>
        </button>

        <Link
          href="/requests"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          className="relative h-9 w-9 inline-flex items-center justify-center rounded-input hover:bg-surface-2"
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unreadCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-danger-700 text-white text-[10px] font-semibold flex items-center justify-center"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Link>

        <div className="hidden sm:block text-right leading-tight max-w-[180px]">
          <div className="text-sm truncate" title={email}>
            {email}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-text-subtle">
            {role}
          </div>
        </div>

        <form action={signOutAction}>
          <Button variant="ghost" size="icon" aria-label="Sign out">
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        </form>
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
