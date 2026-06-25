// Employee Calendar tab — month grid showing approved time-off across
// all colleagues. Read-only. Owner: "i also want a calender view for
// employees to be able to see if their collegues are off or what".

import { getTranslations } from "next-intl/server";
import { CalendarDays } from "lucide-react";
import { requireSession } from "@/lib/auth-guards";
import { listApprovedTimeOffOverlapping } from "@/lib/db/queries/requests";
import { listEmployees } from "@/lib/db/queries/employees";
import { getSetting } from "@/lib/settings/runtime";
import { resolveLocale } from "@/lib/i18n";

const TYPE_COLORS: Record<string, string> = {
  PTO: "bg-success-50 text-success-700 border-success-200",
  PERSONAL: "bg-success-50 text-success-700 border-success-200",
  SICK: "bg-warning-50 text-warning-800 border-warning-200",
  UNPAID: "bg-surface-2 text-text-muted border-border",
  OTHER:
    "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/40",
};

function fmtMonthYear(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(d);
}

function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA").format(d);
}

function monthSpan(monthOffset: number): { from: string; to: string; first: Date } {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { from: dayKey(first), to: dayKey(last), first };
}

export default async function EmployeeCalendar({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; view?: string }>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const offset = Number.isFinite(parseInt(sp.m ?? "0", 10))
    ? parseInt(sp.m ?? "0", 10)
    : 0;
  // "me" → personal-only events; "all" (default) → whole-team view.
  const viewMode: "all" | "me" = sp.view === "me" ? "me" : "all";
  const t = await getTranslations("employee.calendar");
  const locale = await resolveLocale();
  const dateLocale = locale === "es" ? "es-MX" : "en-US";

  const { from, to, first } = monthSpan(offset);
  const [requestsRaw, employees, company] = await Promise.all([
    listApprovedTimeOffOverlapping({ from, to }),
    listEmployees({ status: "ACTIVE" }),
    getSetting("company"),
  ]);
  const empById = new Map(employees.map((e) => [e.id, e]));
  // Filter once for "Just me" so all downstream rendering matches.
  const requests =
    viewMode === "me"
      ? requestsRaw.filter((r) => r.employeeId === session.user.employeeId)
      : requestsRaw;

  // Build a day -> array of { name, type } for the grid.
  const byDay = new Map<string, { name: string; type: string; selfId: string }[]>();
  const allRequests: { name: string; type: string; from: string; to: string; selfId: string }[] = [];
  for (const r of requests) {
    const emp = empById.get(r.employeeId);
    if (!emp) continue;
    const name = emp.displayName;
    const range = (() => {
      const out: string[] = [];
      const start = new Date(`${r.startDate}T00:00:00Z`);
      const end = new Date(`${r.endDate}T00:00:00Z`);
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        out.push(dayKey(d));
      }
      return out;
    })();
    for (const d of range) {
      const k = byDay.get(d) ?? [];
      k.push({ name, type: r.type, selfId: r.employeeId });
      byDay.set(d, k);
    }
    allRequests.push({
      name,
      type: r.type,
      from: r.startDate,
      to: r.endDate,
      selfId: r.employeeId,
    });
  }

  // Build the month grid: 6 weeks × 7 days starting from the Sunday on
  // or before the 1st.
  const dayOfWeek = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - dayOfWeek);
  const days: { date: Date; inMonth: boolean; key: string; isToday: boolean }[] = [];
  const today = dayKey(new Date());
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push({
      date: d,
      inMonth: d.getMonth() === first.getMonth(),
      key: dayKey(d),
      isToday: dayKey(d) === today,
    });
  }

  const dowLabels = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <main className="space-y-6 p-4 sm:p-6 max-w-3xl mx-auto pb-32">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight antialiased">
            {t("title")}
          </h1>
          <p className="text-sm text-text-muted leading-relaxed">
            {fmtMonthYear(first, dateLocale)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle: All employees ↔ Just me. Preserves the
              current month offset so switching doesn't snap back to
              "today". */}
          <div className="inline-flex items-center rounded-input border border-border bg-surface p-0.5 text-xs">
            <a
              href={`/me/calendar?${new URLSearchParams(
                offset === 0 ? { view: "all" } : { m: String(offset), view: "all" },
              ).toString()}`}
              aria-current={viewMode === "all" ? "page" : undefined}
              className={
                "inline-flex items-center px-2.5 h-8 rounded-chip " +
                (viewMode === "all"
                  ? "bg-brand-50 text-brand-800 font-medium"
                  : "text-text-muted hover:bg-surface-2 hover:text-text")
              }
            >
              {t("viewAll")}
            </a>
            <a
              href={`/me/calendar?${new URLSearchParams(
                offset === 0 ? { view: "me" } : { m: String(offset), view: "me" },
              ).toString()}`}
              aria-current={viewMode === "me" ? "page" : undefined}
              className={
                "inline-flex items-center px-2.5 h-8 rounded-chip " +
                (viewMode === "me"
                  ? "bg-brand-50 text-brand-800 font-medium"
                  : "text-text-muted hover:bg-surface-2 hover:text-text")
              }
            >
              {t("viewMe")}
            </a>
          </div>
          <div className="inline-flex items-center rounded-input border border-border bg-surface p-0.5 text-xs">
            <a
              href={`/me/calendar?${new URLSearchParams({
                m: String(offset - 1),
                view: viewMode,
              }).toString()}`}
              className="inline-flex items-center justify-center h-8 w-8 rounded-chip text-text-muted hover:bg-surface-2 hover:text-text"
              aria-label={t("prev")}
            >
              ‹
            </a>
            {offset !== 0 && (
              <a
                href={`/me/calendar?view=${viewMode}`}
                className="inline-flex items-center px-2.5 h-8 rounded-chip text-text-muted hover:bg-surface-2 hover:text-text"
              >
                {t("today")}
              </a>
            )}
            <a
              href={`/me/calendar?${new URLSearchParams({
                m: String(offset + 1),
                view: viewMode,
              }).toString()}`}
              className="inline-flex items-center justify-center h-8 w-8 rounded-chip text-text-muted hover:bg-surface-2 hover:text-text"
              aria-label={t("next")}
            >
              ›
            </a>
          </div>
        </div>
      </header>

      <div className="rounded-card border border-border/70 bg-surface shadow-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border/60 bg-surface-2/40 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          {dowLabels.map((d, i) => (
            <div key={i} className="px-1 py-1.5 text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const events = byDay.get(d.key) ?? [];
            const isSelf = events.some((e) => e.selfId === session.user.employeeId);
            return (
              <div
                key={i}
                className={
                  "min-h-[64px] sm:min-h-[80px] p-1 sm:p-1.5 border-b border-r border-border/60 text-[11px] " +
                  (d.inMonth ? "bg-surface" : "bg-surface-2/40 text-text-subtle")
                }
              >
                <div
                  className={
                    "flex items-center justify-between mb-0.5 " +
                    (d.isToday ? "font-semibold text-brand-700" : "")
                  }
                >
                  <span>{d.date.getDate()}</span>
                  {isSelf && (
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" aria-label={t("youOff")} />
                  )}
                </div>
                <div className="space-y-1">
                  {events.slice(0, 2).map((e, j) => (
                    <div
                      key={j}
                      className={
                        "truncate rounded px-1.5 py-0.5 text-[11px] leading-tight border " +
                        (TYPE_COLORS[e.type] ?? TYPE_COLORS.OTHER)
                      }
                      title={`${e.name} · ${e.type}`}
                    >
                      {e.name}
                    </div>
                  ))}
                  {events.length > 2 && (
                    <details className="group">
                      <summary
                        className="cursor-pointer list-none text-[11px] font-medium text-text-subtle hover:text-text"
                        title={events
                          .slice(2)
                          .map((e) => `${e.name} (${e.type.toLowerCase()})`)
                          .join(", ")}
                      >
                        +{events.length - 2} more
                      </summary>
                      <div className="mt-1 space-y-0.5 rounded border border-border/60 bg-surface-2/80 p-1">
                        {events.slice(2).map((e, j) => (
                          <div
                            key={`o-${j}`}
                            className={
                              "truncate rounded px-1.5 py-0.5 text-[10px] " +
                              (TYPE_COLORS[e.type] ?? TYPE_COLORS.OTHER)
                            }
                          >
                            {e.name}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {allRequests.length === 0 ? (
        <p className="text-sm text-text-muted">
          {viewMode === "me" ? t("noneMe") : t("none")}
        </p>
      ) : (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
            {t("thisMonth")}
          </h2>
          <ul className="space-y-1.5">
            {allRequests
              .sort((a, b) => a.from.localeCompare(b.from))
              .map((r, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-input border border-border/70 bg-surface px-3 py-2 text-xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={
                        "inline-block h-2 w-2 rounded-full shrink-0 " +
                        ((TYPE_COLORS[r.type] ?? TYPE_COLORS.OTHER ?? "")
                          .split(" ")[0] ?? "bg-slate-400")
                      }
                    />
                    <span className="font-medium truncate">{r.name}</span>
                    <span className="text-text-muted">{r.type.toLowerCase()}</span>
                  </div>
                  <span className="text-text-subtle font-mono text-[11px] shrink-0">
                    {r.from === r.to ? r.from : `${r.from} → ${r.to}`}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <p className="text-[10px] text-text-subtle">
        {t("footer")} · {company.timezone}
      </p>

      {/* Suppress unused import warnings */}
      <CalendarDays className="hidden" />
    </main>
  );
}
