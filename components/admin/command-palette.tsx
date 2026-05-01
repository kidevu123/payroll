// Cmd+K command palette. Filters across employees, periods, and the static
// nav graph (sidebar entries + settings tabs). Targets are passed in from the
// admin layout so we don't fetch on every keystroke; the layout reloads them
// once per request, which is plenty for a small-tenant install.

"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search,
  ArrowRight,
  Users,
  CalendarDays,
  Settings2,
  type LucideIcon,
  Wallet,
  LayoutDashboard,
  MessageSquareWarning,
  Workflow,
  BarChart3,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type CommandTarget = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  group: "navigate" | "employee" | "period" | "settings";
};

const GROUP_LABEL: Record<CommandTarget["group"], string> = {
  navigate: "Navigate",
  employee: "Employees",
  period: "Pay periods",
  settings: "Settings",
};

const GROUP_ICON: Record<CommandTarget["group"], LucideIcon> = {
  navigate: LayoutDashboard,
  employee: Users,
  period: CalendarDays,
  settings: Settings2,
};

// Static nav targets injected client-side so the palette has a useful baseline
// even when no employees or periods exist yet.
const STATIC_NAV: CommandTarget[] = [
  { id: "nav-dashboard", label: "Dashboard", href: "/dashboard", group: "navigate" },
  { id: "nav-employees", label: "Employees", href: "/employees", group: "navigate" },
  { id: "nav-time", label: "Time", href: "/time", group: "navigate" },
  { id: "nav-payroll", label: "Payroll", href: "/payroll", group: "navigate" },
  { id: "nav-requests", label: "Requests", href: "/requests", group: "navigate" },
  { id: "nav-ngteco", label: "NGTeco", href: "/ngteco", group: "navigate" },
  { id: "nav-reports", label: "Reports", href: "/reports", group: "navigate" },
  { id: "nav-audit", label: "Audit", href: "/audit", group: "navigate" },
];

const NAV_ICON_BY_HREF: Record<string, LucideIcon> = {
  "/dashboard": LayoutDashboard,
  "/employees": Users,
  "/time": CalendarDays,
  "/payroll": Wallet,
  "/requests": MessageSquareWarning,
  "/ngteco": Workflow,
  "/reports": BarChart3,
  "/audit": ScrollText,
  "/settings": Settings2,
};

function score(target: CommandTarget, q: string): number {
  if (!q) return 1;
  const qq = q.toLowerCase();
  const label = target.label.toLowerCase();
  if (label === qq) return 1000;
  if (label.startsWith(qq)) return 600;
  if (label.includes(qq)) return 300;
  if (target.hint?.toLowerCase().includes(qq)) return 100;
  return 0;
}

export function CommandPalette({
  open,
  onOpenChange,
  targets,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: CommandTarget[];
  onSelect: (href: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const merged = React.useMemo(() => [...STATIC_NAV, ...targets], [targets]);

  const filtered = React.useMemo(() => {
    return merged
      .map((t) => ({ t, s: score(t, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 30)
      .map((x) => x.t);
  }, [merged, query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus runs after the dialog mounts
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  React.useEffect(() => {
    setActive(0);
  }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = filtered[active];
      if (target) onSelect(target.href);
    }
  }

  // Group filtered for display
  const grouped = React.useMemo(() => {
    const out = new Map<CommandTarget["group"], CommandTarget[]>();
    for (const t of filtered) {
      const list = out.get(t.group) ?? [];
      list.push(t);
      out.set(t.group, list);
    }
    return out;
  }, [filtered]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in z-40" />
        <Dialog.Content
          className="fixed left-1/2 top-[12%] -translate-x-1/2 w-[calc(100vw-2rem)] max-w-xl bg-surface border border-border rounded-card shadow-pop z-50 overflow-hidden"
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <div className="flex items-center gap-3 px-4 h-12 border-b border-border">
            <Search className="h-4 w-4 text-text-subtle" aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search employees, periods, settings..."
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-text-subtle"
            />
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded-chip border border-border bg-surface-2 text-text-subtle">
              esc
            </kbd>
          </div>
          <div className="max-h-[60vh] overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-text-muted">
                No matches.
              </p>
            ) : (
              Array.from(grouped.entries()).map(([group, items]) => {
                const GroupIcon = GROUP_ICON[group];
                return (
                  <div key={group} className="py-1">
                    <div className="px-4 py-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-subtle">
                      <GroupIcon className="h-3 w-3" aria-hidden />
                      {GROUP_LABEL[group]}
                    </div>
                    {items.map((t) => {
                      const i = filtered.indexOf(t);
                      const isActive = i === active;
                      const Icon = group === "navigate" ? NAV_ICON_BY_HREF[t.href] ?? ArrowRight : GROUP_ICON[group];
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onMouseEnter={() => setActive(i)}
                          onClick={() => onSelect(t.href)}
                          className={cn(
                            "w-full text-left px-4 py-2 flex items-center gap-3",
                            isActive
                              ? "bg-brand-50 text-brand-800"
                              : "hover:bg-surface-2 text-text",
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-4 w-4 shrink-0",
                              isActive ? "text-brand-700" : "text-text-subtle",
                            )}
                            aria-hidden
                          />
                          <span className="flex-1 truncate text-sm">{t.label}</span>
                          {t.hint ? (
                            <span className="text-xs text-text-muted truncate max-w-[40%]">
                              {t.hint}
                            </span>
                          ) : null}
                          {isActive ? (
                            <ArrowRight className="h-3.5 w-3.5 text-brand-700" aria-hidden />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
